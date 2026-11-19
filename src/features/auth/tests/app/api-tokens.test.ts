import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { getDatabase } from '../../../../shared/database';
import { closeEventStreams, EVENTS_PATH } from '../../../../shared/realtime';
import { readEvents } from '../../../../shared/realtime/tests/helpers';
import { csrfHeaders, issueCsrf, mergeResponseCookies } from '../../../../shared/security/tests/helpers';
import { AUTH_TOKENS_CHANGED_EVENT, authResponseSchemas } from '../../contract';
import { AUTH_MAINTENANCE, createAuthRoutes, deleteAccounts, hashPassword } from '../..';
import type { AuthActivityEvent } from '../../server/activity';
import { API_TOKENS } from '../../server/config';
import { claimUnverifiedAccount, createApiToken } from '../../server/repository';

/**
 * Personal access tokens, managed from a signed-in browser: create, list,
 * revoke, revoke all, the per-account cap, and what is kept of a secret.
 */
const PASSWORD = 'correct horse battery staple';
const schemas = authResponseSchemas();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface Browser {
  id: string;
  cookie: string;
}

async function send(browser: Browser | undefined, path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method ?? 'GET';
  let headers: Record<string, string> = browser ? { Cookie: browser.cookie } : {};
  if (method !== 'GET') {
    const state = await issueCsrf(app, browser?.cookie || undefined);
    if (browser) browser.cookie = state.cookie;
    headers = csrfHeaders(state, { 'Content-Type': 'application/json' });
  }
  const response = await app.request(path, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (browser) browser.cookie = mergeResponseCookies(browser.cookie, response);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function signUp(): Promise<Browser> {
  const browser = { id: '', cookie: '' };
  const response = await send(browser, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Token Holder', email: `${randomUUID()}@example.com`, password: PASSWORD },
  });
  expect(response.status).toBe(201);
  browser.id = response.body.data.user.id as string;
  return browser;
}

/** Creates a token, confirming with the account's password unless the body names one. */
const create = (browser: Browser, body: Record<string, unknown>) =>
  send(browser, '/api/auth/tokens', { method: 'POST', body: { password: PASSWORD, ...body } });

function storedRows(userId: string) {
  return getDatabase().prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at, rowid').all(userId) as Array<
    Record<string, unknown>
  >;
}

afterEach(() => {
  closeEventStreams();
});

describe('personal access tokens', () => {
  it('creates a token and shows its secret only in the create answer', async () => {
    const browser = await signUp();
    const before = Date.now();

    const created = await create(browser, { name: 'Zapier', scope: 'write', expiresInDays: 30 });

    expect(created.status).toBe(201);
    const { data } = schemas.apiTokenCreated.parse(created.body);
    expect(data.secret).toMatch(/^mcr_[A-Za-z0-9_-]{43}$/);
    expect(data.token).toMatchObject({
      name: 'Zapier',
      scope: 'write',
      prefix: data.secret.slice(0, 10),
      lastUsedAt: null,
      expired: false,
    });
    expect(data.token.expiresAt! - data.token.createdAt).toBe(30 * 24 * 60 * 60 * 1000);
    expect(data.token.createdAt).toBeGreaterThanOrEqual(before);

    const listed = await send(browser, '/api/auth/tokens');
    expect(listed.status).toBe(200);
    expect(schemas.apiTokens.parse(listed.body).data.tokens).toEqual([data.token]);
    expect(JSON.stringify(listed.body)).not.toContain(data.secret);
  });

  it('re-confirms the password before creating a token, as two-factor changes do', async () => {
    const browser = await signUp();

    const wrong = await create(browser, { name: 'stolen session', scope: 'write', expiresInDays: null, password: 'not the password' });
    expect(wrong.status).toBe(400);
    expect(schemas.error.parse(wrong.body)).toMatchObject({ message: 'Password is incorrect', code: 'INVALID_PASSWORD' });
    const twoFactor = await send(browser, '/api/auth/two-factor/setup', { method: 'POST', body: { password: 'not the password' } });
    expect([twoFactor.status, twoFactor.body]).toEqual([wrong.status, wrong.body]);

    resetSecurityState();
    for (const password of [undefined, '']) {
      const missing = await send(browser, '/api/auth/tokens', {
        method: 'POST',
        body: { name: 'no password', scope: 'write', expiresInDays: null, password },
      });
      expect(missing.status).toBe(422);
      expect(schemas.error.parse(missing.body)).toMatchObject({ code: 'VALIDATION_ERROR', errors: { password: [expect.any(String)] } });
    }
    expect(storedRows(browser.id)).toEqual([]);
  });

  it('asks an account without a usable password to have signed in within the last 5 minutes instead', async () => {
    const browser = await signUp();
    // What Google sign-in stores for a new account: a random password nobody knows.
    getDatabase()
      .prepare('UPDATE users SET password = ?, password_usable = 0 WHERE id = ?')
      .run(await hashPassword(randomUUID()), browser.id);
    expect((await send(browser, '/api/auth/me')).body.data.user.hasPassword).toBe(false);

    // Just signed in: no password to type, and any sent is not checked.
    expect((await create(browser, { name: 'fresh', scope: 'read', password: undefined })).status).toBe(201);
    expect((await create(browser, { name: 'fresh again', scope: 'read', password: 'anything' })).status).toBe(201);

    // The same session a little over 5 minutes later.
    getDatabase()
      .prepare('UPDATE sessions SET created_at = ? WHERE user_id = ?')
      .run(Date.now() - API_TOKENS.REAUTH_WINDOW_MS - 1_000, browser.id);
    const stale = await create(browser, { name: 'stale', scope: 'read', password: undefined });
    expect(stale.status).toBe(403);
    expect(schemas.error.parse(stale.body).code).toBe('REAUTH_REQUIRED');
    expect(storedRows(browser.id)).toHaveLength(2);
  });

  it('expires a new token after 90 days unless the request names an expiry or null for never', async () => {
    const browser = await signUp();
    const DAY = 24 * 60 * 60 * 1000;

    const defaulted = schemas.apiTokenCreated.parse((await create(browser, { name: 'default', scope: 'read' })).body).data.token;
    expect(defaulted.expiresAt! - defaulted.createdAt).toBe(90 * DAY);
    const never = schemas.apiTokenCreated.parse((await create(browser, { name: 'never', scope: 'read', expiresInDays: null })).body).data.token;
    expect(never.expiresAt).toBeNull();
    const longest = schemas.apiTokenCreated.parse((await create(browser, { name: 'year', scope: 'read', expiresInDays: 365 })).body).data.token;
    expect(longest.expiresAt! - longest.createdAt).toBe(365 * DAY);
  });

  it('stores only the SHA-256 of the secret', async () => {
    const browser = await signUp();
    const { secret } = (await create(browser, { name: 'CI', scope: 'read', expiresInDays: null })).body.data;

    const [row] = storedRows(browser.id);
    expect(row).toMatchObject({ token_hash: sha256(secret), prefix: secret.slice(0, 10), scope: 'read', expires_at: null });
    expect(Object.values(row!).some((value) => typeof value === 'string' && value.includes(secret.slice(10)))).toBe(false);
  });

  it('lists the newest first and keeps expired tokens, but never revoked ones', async () => {
    const browser = await signUp();
    const old = (await create(browser, { name: 'old', scope: 'read', expiresInDays: 1 })).body.data.token;
    const kept = (await create(browser, { name: 'kept', scope: 'read', expiresInDays: null })).body.data.token;
    const gone = (await create(browser, { name: 'gone', scope: 'write', expiresInDays: null })).body.data.token;
    getDatabase().prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(Date.now() - 1, old.id);

    expect((await send(browser, `/api/auth/tokens/${gone.id}`, { method: 'DELETE' })).body).toEqual({
      success: true,
      message: 'API token revoked',
      data: { revoked: 1 },
    });

    const tokens = schemas.apiTokens.parse((await send(browser, '/api/auth/tokens')).body).data.tokens;
    expect(tokens.map((token) => [token.name, token.expired])).toEqual([
      ['kept', false],
      ['old', true],
    ]);
    expect(kept.id).toBe(tokens[0]!.id);
  });

  it('revokes only the account’s own tokens', async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const token = (await create(owner, { name: 'mine', scope: 'read', expiresInDays: null })).body.data.token;

    const refused = await send(stranger, `/api/auth/tokens/${token.id}`, { method: 'DELETE' });
    expect(refused.status).toBe(404);
    expect(schemas.error.parse(refused.body).code).toBe('NOT_FOUND');
    expect(storedRows(owner.id)[0]!.revoked_at).toBeNull();

    expect((await send(owner, `/api/auth/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await send(owner, `/api/auth/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('revokes every token of the account at once', async () => {
    const browser = await signUp();
    const other = await signUp();
    await create(browser, { name: 'a', scope: 'read', expiresInDays: null });
    await create(browser, { name: 'b', scope: 'write', expiresInDays: 7 });
    await create(other, { name: 'c', scope: 'write', expiresInDays: 7 });

    const revoked = await send(browser, '/api/auth/tokens/revoke-all', { method: 'POST' });
    expect(schemas.revokeApiTokens.parse(revoked.body).data.revoked).toBe(2);
    expect((await send(browser, '/api/auth/tokens')).body.data.tokens).toEqual([]);
    expect((await send(other, '/api/auth/tokens')).body.data.tokens).toHaveLength(1);
    expect((await send(browser, '/api/auth/tokens/revoke-all', { method: 'POST' })).body.data.revoked).toBe(0);
  });

  it(`holds at most ${API_TOKENS.MAX_ACTIVE_PER_USER} working tokens per account`, async () => {
    const browser = await signUp();
    for (let index = 0; index < API_TOKENS.MAX_ACTIVE_PER_USER - 1; index += 1) {
      createApiToken(
        { id: randomUUID(), userId: browser.id, name: `t${index}`, tokenHash: randomUUID(), prefix: 'mcr_xxxxxx', scope: 'read', expiresAt: null },
        API_TOKENS.MAX_ACTIVE_PER_USER,
      );
    }
    const last = await create(browser, { name: 'last', scope: 'read', expiresInDays: null });
    expect(last.status).toBe(201);

    const refused = await create(browser, { name: 'one too many', scope: 'read', expiresInDays: null });
    expect(refused.status).toBe(409);
    expect(schemas.error.parse(refused.body).code).toBe('TOKEN_LIMIT_REACHED');

    // An expired token no longer counts, nor does a revoked one.
    getDatabase().prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(Date.now() - 1, last.body.data.token.id);
    resetSecurityState();
    expect((await create(browser, { name: 'replacement', scope: 'read', expiresInDays: null })).status).toBe(201);
    expect((await create(browser, { name: 'again too many', scope: 'read', expiresInDays: null })).status).toBe(409);
  });

  it('refuses names, scopes and expiries outside the contract', async () => {
    const browser = await signUp();
    for (const body of [
      { name: '', scope: 'read', expiresInDays: null },
      { name: 'x'.repeat(81), scope: 'read', expiresInDays: null },
      { name: 'ok', scope: 'admin', expiresInDays: null },
      { name: 'ok', scope: 'read', expiresInDays: 0 },
      { name: 'ok', scope: 'read', expiresInDays: 366 },
      { name: 'ok', scope: 'read', expiresInDays: 1.5 },
      { name: 'ok', expiresInDays: null },
      { name: 'ok', scope: 'read', expiresInDays: null, password: 42 },
    ]) {
      resetSecurityState();
      const refused = await create(browser, body);
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(schemas.error.parse(refused.body).code).toBe('VALIDATION_ERROR');
    }
    expect(storedRows(browser.id)).toEqual([]);
  });

  it('needs a signed-in browser for every token endpoint', async () => {
    expect((await send(undefined, '/api/auth/tokens')).status).toBe(401);
    expect(
      (await send(undefined, '/api/auth/tokens', { method: 'POST', body: { name: 'x', scope: 'read', expiresInDays: null, password: PASSWORD } }))
        .status,
    ).toBe(401);
    expect((await send(undefined, '/api/auth/tokens/revoke-all', { method: 'POST' })).status).toBe(401);
    expect((await send(undefined, `/api/auth/tokens/${randomUUID()}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('tells the account’s other tabs that its tokens changed', async () => {
    const browser = await signUp();
    const response = await app.request(EVENTS_PATH, { headers: { Cookie: browser.cookie } });
    const events = readEvents(response);
    expect(await events.next()).toBe('stream.ready');

    const token = (await create(browser, { name: 'live', scope: 'read', expiresInDays: null })).body.data.token;
    expect(await events.next()).toBe(AUTH_TOKENS_CHANGED_EVENT);
    await send(browser, `/api/auth/tokens/${token.id}`, { method: 'DELETE' });
    expect(await events.next()).toBe(AUTH_TOKENS_CHANGED_EVENT);
    await create(browser, { name: 'again', scope: 'read', expiresInDays: null });
    expect(await events.next()).toBe(AUTH_TOKENS_CHANGED_EVENT);
    await send(browser, '/api/auth/tokens/revoke-all', { method: 'POST' });
    expect(await events.next()).toBe(AUTH_TOKENS_CHANGED_EVENT);
  });

  it('reports creating and revoking tokens without the secret', async () => {
    const reported: AuthActivityEvent[] = [];
    const routes = createAuthRoutes((event) => reported.push(event));
    const registered = await routes.request('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reporter', email: `${randomUUID()}@example.com`, password: PASSWORD }),
    });
    const cookie = registered.headers.get('set-cookie')!.split(';', 1)[0]!;
    const userId = ((await registered.json()) as { data: { user: { id: string } } }).data.user.id;
    const call = (path: string, method: string, body?: unknown) =>
      routes.request(path, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const created = (await (await call('/tokens', 'POST', { name: 'Reported', scope: 'write', expiresInDays: null, password: PASSWORD })).json()) as {
      data: { token: { id: string }; secret: string };
    };
    await call(`/tokens/${created.data.token.id}`, 'DELETE');
    await call('/tokens', 'POST', { name: 'Second', scope: 'read', expiresInDays: 3, password: PASSWORD });
    await call('/tokens/revoke-all', 'POST');

    const tokenEvents = reported.filter((event) => event.action !== 'auth.registered');
    expect(tokenEvents).toEqual([
      { action: 'auth.token-created', resource: 'auth', actorId: userId, targetId: userId, targetLabel: 'Reporter', metadata: { name: 'Reported', scope: 'write' } },
      { action: 'auth.token-revoked', resource: 'auth', actorId: userId, targetId: userId, targetLabel: 'Reporter', metadata: { name: 'Reported', scope: 'write' } },
      { action: 'auth.token-created', resource: 'auth', actorId: userId, targetId: userId, targetLabel: 'Reporter', metadata: { name: 'Second', scope: 'read' } },
      { action: 'auth.tokens-revoked', resource: 'auth', actorId: userId, targetId: userId, targetLabel: 'Reporter', metadata: { revoked: 1 } },
    ]);
    expect(JSON.stringify(reported)).not.toContain(created.data.secret);
  });

  it('removes an account’s tokens with the account', async () => {
    const browser = await signUp();
    await create(browser, { name: 'doomed', scope: 'write', expiresInDays: null });
    expect(storedRows(browser.id)).toHaveLength(1);

    deleteAccounts([browser.id]);

    expect(storedRows(browser.id)).toEqual([]);
  });

  it('drops the tokens of an unverified account someone claims with Google', async () => {
    const browser = await signUp();
    await create(browser, { name: 'planted', scope: 'write', expiresInDays: null });

    claimUnverifiedAccount(browser.id, 'unusable');

    expect(storedRows(browser.id)).toEqual([]);
  });

  it('purges tokens revoked or expired more than 30 days ago during maintenance', async () => {
    const browser = await signUp();
    const ids: string[] = [];
    for (const name of ['revoked long ago', 'expired long ago', 'revoked lately', 'expired lately', 'working']) {
      ids.push((await create(browser, { name, scope: 'read', expiresInDays: null })).body.data.token.id as string);
      resetSecurityState();
    }
    const now = Date.now();
    const longAgo = now - API_TOKENS.PURGE_AFTER_MS - 1;
    const lately = now - API_TOKENS.PURGE_AFTER_MS + 60_000;
    const database = getDatabase();
    database.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(longAgo, ids[0]);
    database.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(longAgo, ids[1]);
    database.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(lately, ids[2]);
    database.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(lately, ids[3]);

    const task = AUTH_MAINTENANCE.find((candidate) => candidate.name === 'stale-api-tokens')!;
    expect(task.run(now)).toMatchObject({ removed: expect.any(Number) });

    expect(storedRows(browser.id).map((row) => row.name)).toEqual(['revoked lately', 'expired lately', 'working']);
  });
});
