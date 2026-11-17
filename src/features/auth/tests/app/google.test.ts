import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../../app/server';
import { signIn, signUp } from '../../../../app/tests/personas';
import { mergeResponseCookies } from '../../../../shared/security/tests/helpers';
import { GOOGLE } from '../../server/config';
import { GOOGLE_STATE_COOKIE_NAME } from '../../server/google';
import { enableTwoFactor, findUserByEmail } from '../../server/repository';

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
  const returned = options.tamperState ? `${state.slice(0, -1)}0` : state;
  const callback = await app.request(`/api/auth/google/callback?code=google-code&state=${returned}`, {
    headers: { Cookie: cookie },
  });
  return { callback, cookie: mergeResponseCookies(cookie, callback) };
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
    await expect(me.json()).resolves.toMatchObject({ data: { user: { email, name: 'Grace Google', verified: true } } });
    // V1 used the email as the password of Google accounts.
    await expect(signIn(email, email)).rejects.toThrow('Sign-in failed with 401');
  });

  it('signs in to the existing account with that email', async () => {
    const existing = await signUp('Existing Person');
    stubGoogle({ email: existing.email, name: 'Someone Else', verified_email: true });

    const { callback, cookie } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/');
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    await expect(me.json()).resolves.toMatchObject({ data: { user: { id: existing.id, name: 'Existing Person' } } });
  });

  it('refuses an email Google has not verified, creating nothing', async () => {
    const email = `${randomUUID()}@example.com`;
    stubGoogle({ email, verified_email: false });

    const { callback, cookie } = await signInWithGoogle();

    expect(callback.headers.get('location')).toBe('/login?google-error=unverified');
    expect(cookie).not.toContain('auth_id=');
    expect(findUserByEmail(email)).toBeUndefined();
  });

  it('asks an account with two-factor for its code instead of signing in', async () => {
    const existing = await signUp('Two Factor Person');
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
