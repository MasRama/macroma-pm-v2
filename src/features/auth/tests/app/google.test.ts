import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../../app/server';
import { signIn, signUp, TEST_PASSWORD, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { csrfHeaders, issueCsrf, mergeResponseCookies } from '../../../../shared/security/tests/helpers';
import { GOOGLE } from '../../server/config';
import { GOOGLE_STATE_COOKIE_NAME } from '../../server/google';
import { enableTwoFactor, findUserByEmail, findUserById } from '../../server/repository';

interface GoogleAccount {
  email: string;
  name?: string;
  verified_email?: boolean;
}

/** Stands in for Google's token and profile endpoints. */
function stubGoogle(account: GoogleAccount | 'failing') {
  const fetchStub = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (account === 'failing') return new Response('nope', { status: 500 });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'google-access-token' });
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return Response.json(account);
    return new Response('unexpected', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return fetchStub;
}

/** Starts a sign-in and comes back from Google with the state it was given. */
async function signInWithGoogle(options: { tamperState?: boolean } = {}) {
  const redirect = await app.request('/api/auth/google/redirect');
  expect(redirect.status).toBe(302);
  const cookie = mergeResponseCookies(undefined, redirect);
  const state = new URL(redirect.headers.get('location')!).searchParams.get('state')!;
  // Changes the last character, whatever it is.
  const returned = options.tamperState ? `${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}` : state;
  const callback = await app.request(`/api/auth/google/callback?code=google-code&state=${returned}`, {
    headers: { Cookie: cookie },
  });
  return { callback, cookie: mergeResponseCookies(cookie, callback) };
}

/** An account whose email was proven, as Google sign-in or an administrator marks it. */
async function verifiedAccount(name: string): Promise<Persona> {
  const persona = await signUp(name);
  getDatabase().prepare('UPDATE users SET verified = 1 WHERE id = ?').run(persona.id);
  return persona;
}

async function currentUser(cookie: string) {
  const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
  return { status: me.status, user: me.status === 200 ? ((await me.json()) as { data: { user: { id: string; verified: boolean } } }).data.user : undefined };
}

describe('Google sign-in', () => {
  const original = { ...GOOGLE };

  beforeEach(() => {
    Object.assign(GOOGLE, {
      clientId: 'client-id.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:5555/api/auth/google/callback',
    });
  });

  afterEach(() => {
    Object.assign(GOOGLE, original);
    vi.unstubAllGlobals();
  });

  it('answers 404 GOOGLE_DISABLED while it is not configured', async () => {
    Object.assign(GOOGLE, { clientId: undefined, clientSecret: undefined, redirectUri: undefined });
    for (const path of ['/api/auth/google/redirect', '/api/auth/google/callback?code=x&state=y']) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ success: false, code: 'GOOGLE_DISABLED' });
    }
  });

  it('sends the browser to Google with a state bound to an HttpOnly cookie', async () => {
    const response = await app.request('/api/auth/google/redirect');
    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:5555/api/auth/google/callback');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${GOOGLE_STATE_COOKIE_NAME}=${location.searchParams.get('state')}`);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it('refuses a callback whose state does not match, without asking Google', async () => {
    const fetchStub = stubGoogle({ email: `${randomUUID()}@example.com`, verified_email: true });
    const { callback } = await signInWithGoogle({ tamperState: true });

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/login?google-error=state');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('creates a verified account for a new Google email, with no password anyone knows', async () => {
    const email = `${randomUUID()}@example.com`;
    stubGoogle({ email: email.toUpperCase(), name: 'Grace Google', verified_email: true });

    const { callback, cookie } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/');
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    await expect(me.json()).resolves.toMatchObject({
      data: { user: { email, name: 'Grace Google', verified: true, hasPassword: false } },
    });
    // V1 used the email as the password of Google accounts.
    await expect(signIn(email, email)).rejects.toThrow('Sign-in failed with 401');

    // Fresh from Google, it makes an API token without a password to type.
    const csrf = await issueCsrf(app, cookie);
    const created = await app.request('/api/auth/tokens', {
      method: 'POST',
      headers: csrfHeaders(csrf, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'From Google', scope: 'read' }),
    });
    expect(created.status).toBe(201);
  });

  it('signs in to the existing verified account with that email, keeping its password', async () => {
    const existing = await verifiedAccount('Existing Person');
    stubGoogle({ email: existing.email, name: 'Someone Else', verified_email: true });

    const { callback, cookie } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/');
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    await expect(me.json()).resolves.toMatchObject({ data: { user: { id: existing.id, name: 'Existing Person', hasPassword: true } } });
    expect((await currentUser(existing.cookie)).status).toBe(200);
    await expect(signIn(existing.email, TEST_PASSWORD)).resolves.toContain('auth_id=');
  });

  it('takes an unverified account back from whoever registered it with the Google email', async () => {
    // Registration does not prove the email: someone may register the victim's address first.
    const squatter = await signUp('Squatter');
    enableTwoFactor(squatter.id, 'JBSWY3DPEHPK3PXP', 0, ['recovery-hash']);
    const before = findUserById(squatter.id)!;
    stubGoogle({ email: squatter.email, name: 'Victim', verified_email: true });

    const { callback, cookie } = await signInWithGoogle();

    // Google proved who owns the email, so it signs in without the squatter's second factor.
    expect(callback.headers.get('location')).toBe('/');
    expect(await currentUser(cookie)).toMatchObject({ status: 200, user: { id: squatter.id, verified: true, hasPassword: false } });
    // Nothing the squatter set up still opens the account.
    expect((await currentUser(squatter.cookie)).status).toBe(401);
    await expect(signIn(squatter.email, TEST_PASSWORD)).rejects.toThrow('Sign-in failed with 401');
    const after = findUserById(squatter.id)!;
    expect(after.password).not.toBe(before.password);
    const twoFactor = getDatabase()
      .prepare('SELECT two_factor_secret, two_factor_pending_secret FROM users WHERE id = ?')
      .get(squatter.id) as { two_factor_secret: string | null; two_factor_pending_secret: string | null };
    expect(twoFactor).toEqual({ two_factor_secret: null, two_factor_pending_secret: null });
    const leftovers = getDatabase()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM two_factor_recovery_codes WHERE user_id = @id)
              + (SELECT COUNT(*) FROM two_factor_challenges WHERE user_id = @id)
              + (SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = @id) AS count`,
      )
      .get({ id: squatter.id }) as { count: number };
    expect(leftovers.count).toBe(0);
    // The application's activity trail records the takeover.
    const claimed = getDatabase()
      .prepare("SELECT actor_id FROM activity_events WHERE action = 'auth.account-claimed' AND target_id = ?")
      .all(squatter.id);
    expect(claimed).toEqual([{ actor_id: squatter.id }]);
  });

  it('refuses an email Google has not verified, creating nothing', async () => {
    const email = `${randomUUID()}@example.com`;
    stubGoogle({ email, verified_email: false });

    const { callback, cookie } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/login?google-error=unverified');
    expect(cookie).not.toContain('auth_id=');
    expect(findUserByEmail(email)).toBeUndefined();
  });

  it('asks a verified account with two-factor for its code instead of signing in', async () => {
    const existing = await verifiedAccount('Two Factor Person');
    enableTwoFactor(existing.id, 'JBSWY3DPEHPK3PXP', 0, []);
    stubGoogle({ email: existing.email, verified_email: true });

    const { callback } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/login?two-factor=1');
    const cookies = callback.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('auth_2fa=');
    expect(cookies).not.toContain('auth_id=');
  });

  it('comes back to the sign-in page when Google cannot be reached', async () => {
    stubGoogle('failing');
    const { callback } = await signInWithGoogle();
    expect(callback.headers.get('location')).toBe('/login?google-error=unavailable');
  });
});
