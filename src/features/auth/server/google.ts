import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { GoogleSignInError } from '../contract';
import { env } from '../../../shared/config';
import { getDatabase } from '../../../shared/database';
import { Logger } from '../../../shared/logging';
import { clientIp, publicRoute } from '../../../shared/security';
import { findRoleBySlug, syncUserRoles } from './access';
import type { AuthActivitySink } from './activity';
import { GOOGLE, GOOGLE_STATE_TTL_MS } from './config';
import { setSessionCookie } from './http';
import { createUser, findUserByEmail, type StoredUser } from './repository';
import { beginTwoFactorChallenge } from './security-routes';
import { endSession, hashPassword, SESSION_COOKIE_NAME, startSession } from './service';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** HttpOnly cookie binding the callback to the browser that started the sign-in. */
export const GOOGLE_STATE_COOKIE_NAME = 'auth_google_state';
const STATE_COOKIE_PATH = '/api/auth/google';

interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function googleSettings(): GoogleSettings | undefined {
  const { clientId, clientSecret, redirectUri } = GOOGLE;
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : undefined;
}

const googleDisabled = (context: Context) =>
  context.json(
    { success: false as const, message: 'Google sign-in is not configured', code: 'GOOGLE_DISABLED' as const },
    404,
  );

const tokenSchema = z.object({ access_token: z.string().min(1) });
const profileSchema = z.object({
  email: z.string().email(),
  verified_email: z.boolean().optional(),
  name: z.string().optional(),
});

/** Exchanges the authorization code for the Google account's email, name, and whether Google verified the email. */
async function fetchGoogleProfile(settings: GoogleSettings, code: string): Promise<z.infer<typeof profileSchema>> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange answered ${tokenResponse.status}`);
  const { access_token: accessToken } = tokenSchema.parse(await tokenResponse.json());

  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new Error(`Google profile request answered ${profileResponse.status}`);
  return profileSchema.parse(await profileResponse.json());
}

function sameState(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A display name Auth accepts: Google's, else the email's local part. */
function accountName(profileName: string | undefined, email: string): string {
  const candidate = (profileName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim() || email.split('@')[0];
  const bounded = candidate.slice(0, 100);
  return bounded.length >= 2 ? bounded : `${bounded}${'_'.repeat(2 - bounded.length)}`;
}

export interface GoogleRoutesOptions {
  /** Registration policy from `createAuthRoutes`: `false` signs in existing accounts only. */
  registration?: false | { role: string };
}

/**
 * Google sign-in. A new email gets an account with a random password nobody
 * knows (a reset by email can set one) and counts as verified; an existing
 * account is signed in, through its second factor when it has one. Google
 * must have verified the email, or the sign-in is refused.
 */
export function createGoogleRoutes(activity: AuthActivitySink | undefined, options: GoogleRoutesOptions = {}) {
  const failed = (context: Context, reason: GoogleSignInError) =>
    context.redirect(`/login?google-error=${reason}`);

  async function createGoogleAccount(email: string, name: string): Promise<StoredUser> {
    const password = await hashPassword(randomBytes(32).toString('hex'));
    const roleSlug = options.registration ? options.registration.role : undefined;
    return getDatabase().transaction(() => {
      const created = createUser({ id: randomUUID(), name, email, password, verified: true });
      if (roleSlug !== undefined) {
        const role = findRoleBySlug(roleSlug);
        if (!role) throw new Error(`Registration role "${roleSlug}" does not exist; declare it with declareRoles.`);
        syncUserRoles(created.id, [role.id]);
      }
      return created;
    })();
  }

  return new Hono()
    .get('/google/redirect', publicRoute, (context) => {
      const settings = googleSettings();
      if (!settings) return googleDisabled(context);
      const state = randomBytes(32).toString('hex');
      setCookie(context, GOOGLE_STATE_COOKIE_NAME, state, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: STATE_COOKIE_PATH,
        maxAge: GOOGLE_STATE_TTL_MS / 1000,
      });
      const params = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      return context.redirect(`${AUTHORIZE_URL}?${params}`);
    })
    .get('/google/callback', publicRoute, async (context) => {
      const settings = googleSettings();
      if (!settings) return googleDisabled(context);
      const expected = getCookie(context, GOOGLE_STATE_COOKIE_NAME);
      deleteCookie(context, GOOGLE_STATE_COOKIE_NAME, { path: STATE_COOKIE_PATH });
      if (!sameState(expected, context.req.query('state'))) {
        Logger.logSecurity('google_state_rejected', { hasExpected: expected !== undefined });
        return failed(context, 'state');
      }
      const code = context.req.query('code');
      if (context.req.query('error') !== undefined || !code) return failed(context, 'denied');

      let profile: z.infer<typeof profileSchema>;
      try {
        profile = await fetchGoogleProfile(settings, code);
      } catch (error) {
        Logger.error('Google sign-in failed', error instanceof Error ? error : { error: String(error) });
        return failed(context, 'unavailable');
      }
      // An unverified Google email proves nothing about who owns it.
      if (profile.verified_email !== true) return failed(context, 'unverified');

      const email = profile.email.trim().toLowerCase();
      let user = findUserByEmail(email);
      if (!user) {
        if (options.registration === false) return failed(context, 'registration-closed');
        user = await createGoogleAccount(email, accountName(profile.name, email));
        Logger.logAuth('google_registration_success', { userId: user.id });
        activity?.({
          action: 'auth.registered',
          resource: 'auth',
          actorId: user.id,
          targetId: user.id,
          targetLabel: user.name,
          metadata: { method: 'google' },
        });
      }

      if (beginTwoFactorChallenge(context, user.id)) {
        Logger.logAuth('login_two_factor_required', { userId: user.id, method: 'google' });
        return context.redirect('/login?two-factor=1');
      }
      endSession(getCookie(context, SESSION_COOKIE_NAME));
      setSessionCookie(context, startSession(user, context.req.header('user-agent'), clientIp(context)));
      Logger.logAuth('login_success', { userId: user.id, method: 'google' });
      activity?.({
        action: 'auth.login',
        resource: 'auth',
        actorId: user.id,
        targetId: user.id,
        targetLabel: user.name,
        metadata: { method: 'google' },
      });
      return context.redirect('/');
    });
}
