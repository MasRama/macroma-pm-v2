// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context, Hono } from 'hono';

/**
 * The public API's bearer pipeline through the composed application. No
 * `/api/v1` route exists yet, so the application is loaded afresh with a
 * throwaway `/api/v1/_probe` router mounted where Feature routers mount, and
 * with the logger captured to prove a secret never reaches it.
 */
const logged: string[] = [];

type Loaded = Awaited<ReturnType<typeof loadApplication>>;

async function loadApplication() {
  vi.resetModules();
  const record = (...args: unknown[]) => {
    logged.push(JSON.stringify(args));
  };
  vi.doMock('pino', () => ({
    default: () => ({ trace: record, debug: record, info: record, warn: record, error: record, fatal: record }),
  }));
  vi.doMock('../bindings/notifications.server', async (importOriginal) => {
    const original = await importOriginal<typeof import('../bindings/notifications.server')>();
    const { Hono: Router } = await import('hono');
    const { apiTokenAccount } = await import('../../features/auth');
    const { createGuard } = await import('../../shared/security');
    const guard = createGuard((context) => apiTokenAccount(context));
    const answer = (context: Context) =>
      context.json({ success: true, message: 'OK', data: { account: guard.actor(context), method: context.req.method } });
    const probe = new Router().get('/', guard.signedIn, answer).post('/', guard.signedIn, answer).delete('/', guard.signedIn, answer);
    return {
      ...original,
      default: (app: Hono) => {
        original.default(app);
        app.route('/api/v1/_probe', probe);
      },
    };
  });
  const database = await import('../../shared/database');
  database.migrate();
  const server = await import('../server');
  const auth = await import('../../features/auth');
  auth.syncDeclaredPermissions();
  auth.syncDeclaredRoles();
  const personas = await import('./personas');
  const config = await import('../../shared/config');
  return { app: server.app, resetSecurityState: server.resetSecurityState, auth, personas, database, env: config.env };
}

let loaded: Loaded;

beforeAll(async () => {
  loaded = await loadApplication();
});

beforeEach(() => {
  loaded.resetSecurityState();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Answer {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

async function v1(token: string | undefined, method = 'GET', extra: Record<string, string> = {}, path = '/api/v1/_probe'): Promise<Answer> {
  const headers: Record<string, string> = { ...extra };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const response = await loaded.app.request(path, { method, headers });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {}, headers: response.headers };
}

async function sessionCall(cookie: string, method: string, path: string, body?: unknown) {
  const { csrfHeaders, issueCsrf } = await import('../../shared/security/tests/helpers');
  const headers =
    method === 'GET'
      ? { Cookie: cookie }
      : csrfHeaders(await issueCsrf(loaded.app, cookie), { 'Content-Type': 'application/json' });
  const response = await loaded.app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any>, response };
}

function expectRefusal(answer: Answer, status: number, code: string): void {
  expect(answer.status).toBe(status);
  expect(answer.body).toMatchObject({ success: false, code });
}

describe('public API bearer pipeline', () => {
  it('admits a working token as its account, without CSRF and without setting cookies', async () => {
    const persona = await loaded.personas.signUp('Bearer Holder');
    const token = await loaded.personas.issueApiToken(persona, 'write');

    const read = await v1(token);
    expect(read.status).toBe(200);
    expect(read.body.data.account).toEqual({ id: persona.id, name: 'Bearer Holder', email: persona.email });
    expect(read.headers.get('set-cookie')).toBeNull();
    expect(read.headers.get('cache-control')).toBe('no-store');

    const written = await v1(token, 'POST');
    expect(written.status).toBe(200);
    expect(written.body.data.method).toBe('POST');
    expect(written.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a missing or malformed Authorization header as TOKEN_INVALID before any lookup', async () => {
    const missing = await v1(undefined);
    expectRefusal(missing, 401, 'TOKEN_INVALID');
    expect(missing.headers.get('www-authenticate')).toBe('Bearer');
    expect(missing.headers.get('set-cookie')).toBeNull();

    for (const header of ['Basic abc', 'Bearer', 'Bearer mcr_short', `Bearer xyz_${'a'.repeat(43)}`, `Bearer mcr_${'a'.repeat(44)}`, `Bearer mcr_${'a'.repeat(42)}!`]) {
      const answer = await v1(undefined, 'GET', { Authorization: header });
      expectRefusal(answer, 401, 'TOKEN_INVALID');
      expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    }
  });

  it('refuses a well-formed token nobody issued', async () => {
    expectRefusal(await v1(`mcr_${'A'.repeat(43)}`), 401, 'TOKEN_INVALID');
  });

  it('accepts the scheme in any letter case', async () => {
    const token = await loaded.personas.issueApiToken(await loaded.personas.signUp(), 'read');
    expect((await v1(undefined, 'GET', { Authorization: `bearer ${token}` })).status).toBe(200);
  });

  it('says a revoked token was revoked', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'write');
    const listed = await sessionCall(persona.cookie, 'GET', '/api/auth/tokens');
    const [{ id }] = listed.body.data.tokens as Array<{ id: string }>;

    expect((await sessionCall(persona.cookie, 'DELETE', `/api/auth/tokens/${id}`)).status).toBe(200);

    const answer = await v1(token);
    expectRefusal(answer, 401, 'TOKEN_REVOKED');
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  });

  it('says an expired token expired', async () => {
    const token = await loaded.personas.issueApiToken(await loaded.personas.signUp(), 'write', 1);
    expect((await v1(token)).status).toBe(200);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);

    expectRefusal(await v1(token), 401, 'TOKEN_EXPIRED');
  });

  it('lets a read token use GET and HEAD only', async () => {
    const token = await loaded.personas.issueApiToken(await loaded.personas.signUp(), 'read');

    expect((await v1(token)).status).toBe(200);
    expect((await v1(token, 'HEAD')).status).toBe(200);
    for (const method of ['POST', 'DELETE']) {
      const answer = await v1(token, method);
      expectRefusal(answer, 403, 'TOKEN_SCOPE_INSUFFICIENT');
      expect(answer.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"');
    }
  });

  it('pauses every token while a temporary password is pending, and resumes once it is replaced', async () => {
    let persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'write');

    persona = await loaded.personas.requirePasswordChange(persona);
    expectRefusal(await v1(token), 403, 'PASSWORD_CHANGE_REQUIRED');
    expectRefusal(await v1(token, 'POST'), 403, 'PASSWORD_CHANGE_REQUIRED');

    const changed = await sessionCall(persona.cookie, 'POST', '/api/auth/change-password', {
      current_password: loaded.personas.TEST_PASSWORD,
      new_password: 'a different long passphrase',
    });
    expect(changed.status).toBe(200);
    expect((await v1(token)).status).toBe(200);
  });

  it('leaves a session cookie’s pending temporary password to the session routes', async () => {
    // The session gate would refuse this cookie; the public API answers by the token alone.
    const holder = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(holder, 'write');
    const temporary = await loaded.personas.requirePasswordChange(await loaded.personas.signUp());
    const gated = await sessionCall(temporary.cookie, 'GET', '/api/auth/tokens');
    expect([gated.status, gated.body.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);

    const answer = await v1(token, 'POST', { Cookie: temporary.cookie });
    expect(answer.status).toBe(200);
    expect(answer.body.data.account.id).toBe(holder.id);
  });

  it('keeps tokens working after the account changes its password', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'write');

    const changed = await sessionCall(persona.cookie, 'POST', '/api/auth/change-password', {
      current_password: loaded.personas.TEST_PASSWORD,
      new_password: 'another long passphrase',
    });
    expect(changed.status).toBe(200);

    expect((await v1(token, 'POST')).status).toBe(200);
  });

  it('stops answering for a deleted account', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'write');
    loaded.auth.deleteAccounts([persona.id]);

    expectRefusal(await v1(token), 401, 'TOKEN_INVALID');
  });

  it('ignores session cookies on the public API', async () => {
    const persona = await loaded.personas.signUp();

    const answer = await v1(undefined, 'GET', { Cookie: persona.cookie });
    expectRefusal(answer, 401, 'TOKEN_INVALID');
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it('never lets a bearer token reach session routes', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'write');
    const bearer = { Authorization: `Bearer ${token}` };

    for (const path of ['/api/auth/tokens', '/api/auth/me', '/api/projects']) {
      const response = await loaded.app.request(path, { headers: bearer });
      expect(response.status, path).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe('UNAUTHORIZED');
    }
    // A write without the CSRF pair is refused before it could mint a token.
    const minted = await loaded.app.request('/api/auth/tokens', {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'escalation', scope: 'write', expiresInDays: null }),
    });
    expect(minted.status).toBe(403);
  });

  it('limits each token on its own and answers 429 RATE_LIMITED with rate headers', async () => {
    const persona = await loaded.personas.signUp();
    const busy = await loaded.personas.issueApiToken(persona, 'read');
    const quiet = await loaded.personas.issueApiToken(persona, 'read');
    const max = loaded.env.API_RATE_LIMIT_MAX;

    const first = await v1(busy);
    expect(first.headers.get('x-ratelimit-limit')).toBe(String(max));
    expect(first.headers.get('x-ratelimit-remaining')).toBe(String(max - 1));
    for (let request = 1; request < max; request += 1) expect((await v1(busy)).status).toBe(200);

    const limited = await v1(busy);
    expectRefusal(limited, 429, 'RATE_LIMITED');
    expect(limited.headers.get('retry-after')).not.toBeNull();
    expect((await v1(quiet)).status).toBe(200);
  });

  it('counts requests without a working token per client address', async () => {
    const max = loaded.env.API_RATE_LIMIT_MAX;
    const fromOne = { 'x-test-ip': '203.0.113.7' };
    for (let request = 0; request < max; request += 1) {
      // Each request makes up a different token; they still share the address's budget.
      expect((await v1(`mcr_${String(request).padStart(43, 'x')}`, 'GET', fromOne)).status).toBe(401);
    }
    expectRefusal(await v1(`mcr_${'y'.repeat(43)}`, 'GET', fromOne), 429, 'RATE_LIMITED');
    expectRefusal(await v1(`mcr_${'y'.repeat(43)}`, 'GET', { 'x-test-ip': '203.0.113.8' }), 401, 'TOKEN_INVALID');
  });

  it('keeps public API traffic out of the browser’s RATE_LIMIT_MAX budget', async () => {
    const shared = loaded;
    vi.stubEnv('RATE_LIMIT_MAX', '5');
    try {
      loaded = await loadApplication();
      expect(loaded.env.RATE_LIMIT_MAX).toBe(5);
      const persona = await loaded.personas.signUp();
      const token = await loaded.personas.issueApiToken(persona, 'read');
      loaded.resetSecurityState();

      // Twice the browser budget through the public API, from the same address.
      for (let request = 0; request < 10; request += 1) expect((await v1(token)).status).toBe(200);

      for (let request = 0; request < 5; request += 1) {
        expect((await sessionCall(persona.cookie, 'GET', '/api/auth/me')).status).toBe(200);
      }
      const spent = await sessionCall(persona.cookie, 'GET', '/api/auth/me');
      expect([spent.status, spent.body.code]).toEqual([429, 'RATE_LIMITED']);
    } finally {
      vi.unstubAllEnvs();
      loaded = shared;
    }
  });

  it('records when a token was last used, at most once a minute', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'read');
    const lastUsed = async () =>
      ((await sessionCall(persona.cookie, 'GET', '/api/auth/tokens')).body.data.tokens as Array<{ lastUsedAt: number | null }>)[0]!
        .lastUsedAt;
    expect(await lastUsed()).toBeNull();

    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    await v1(token);
    expect(await lastUsed()).toBe(start);

    vi.setSystemTime(start + 30_000);
    await v1(token);
    expect(await lastUsed()).toBe(start);

    vi.setSystemTime(start + 61_000);
    await v1(token);
    expect(await lastUsed()).toBe(start + 61_000);
  });

  it('never writes a secret to the log', async () => {
    const persona = await loaded.personas.signUp();
    const token = await loaded.personas.issueApiToken(persona, 'read');
    await v1(token);
    await v1(token, 'POST');
    await v1(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`);

    expect(logged.join('\n')).toContain('api_token_created');
    expect(logged.join('\n')).not.toContain(token.slice(10));
  });
});
