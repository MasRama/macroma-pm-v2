import { createHash, randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { clientIp } from '../../../shared/security';
import { API_TOKENS } from './config';
import { findApiTokenByHash, touchApiToken, type ApiTokenOwner } from './repository';

/*
 * The public API's bearer pipeline. `/api/v1` reads only the `Authorization`
 * header and never a cookie; every other API route reads only cookies. The
 * application mounts it as resolve → rate limit → require, so the limiter
 * can count per token once the token is known.
 */

const SECRET_PATTERN = /^mcr_[A-Za-z0-9_-]{43}$/;

/** A new secret: the prefix and 256 random bits. Shown once; only its hash is stored. */
export function generateApiTokenSecret(): string {
  return `${API_TOKENS.PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function apiTokenHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

type Outcome =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'active'; token: ApiTokenOwner };

const outcomes = new WeakMap<Context, Outcome>();

function lookup(header: string | undefined, now: number): Outcome {
  if (!header) return { kind: 'missing' };
  const separator = header.indexOf(' ');
  // The scheme is case-insensitive (RFC 9110); the secret is not.
  if (separator < 0 || header.slice(0, separator).toLowerCase() !== 'bearer') return { kind: 'invalid' };
  const secret = header.slice(separator + 1);
  // Anything that cannot be a token is refused without touching the database.
  if (!SECRET_PATTERN.test(secret)) return { kind: 'invalid' };
  const token = findApiTokenByHash(apiTokenHash(secret));
  if (!token) return { kind: 'invalid' };
  if (token.revoked_at !== null) return { kind: 'revoked' };
  if (token.expires_at !== null && token.expires_at <= now) return { kind: 'expired' };
  return { kind: 'active', token };
}

/** Looks the request's bearer token up and remembers the outcome; it never refuses. */
export const resolveApiToken: MiddlewareHandler = async (context, next) => {
  outcomes.set(context, lookup(context.req.header('authorization'), Date.now()));
  await next();
};

/** Rate-limit identity for the public API: the token once it resolves, otherwise the client address. */
export function apiTokenRateKey(context: Context): string {
  const outcome = outcomes.get(context);
  return outcome?.kind === 'active' ? `token:${outcome.token.id}` : `ip:${clientIp(context)}`;
}

const READ_METHODS = new Set(['GET', 'HEAD']);

function invalidToken(context: Context, kind: Exclude<Outcome['kind'], 'active'>) {
  // RFC 6750: a request without credentials gets the challenge but no error.
  context.header('WWW-Authenticate', kind === 'missing' ? 'Bearer' : 'Bearer error="invalid_token"');
  if (kind === 'revoked') {
    return context.json({ success: false as const, message: 'This API token was revoked', code: 'TOKEN_REVOKED' as const }, 401);
  }
  if (kind === 'expired') {
    return context.json({ success: false as const, message: 'This API token has expired', code: 'TOKEN_EXPIRED' as const }, 401);
  }
  return context.json(
    { success: false as const, message: 'Send a valid API token as a Bearer token', code: 'TOKEN_INVALID' as const },
    401,
  );
}

/**
 * Refuses the request unless its token works and allows its method: 401 for
 * a missing, unknown, revoked or expired token, 403 while the account must
 * replace a temporary password or when a read token tries to write.
 */
export const requireApiToken: MiddlewareHandler = async (context, next) => {
  // Answers depend on the caller's credential; no cache may keep them.
  context.header('Cache-Control', 'no-store');
  const outcome = outcomes.get(context) ?? { kind: 'missing' as const };
  if (outcome.kind !== 'active') return invalidToken(context, outcome.kind);
  const { token } = outcome;
  if (token.must_change_password === 1) {
    return context.json(
      {
        success: false as const,
        message: 'Change your temporary password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED' as const,
      },
      403,
    );
  }
  if (token.scope === 'read' && !READ_METHODS.has(context.req.method.toUpperCase())) {
    context.header('WWW-Authenticate', 'Bearer error="insufficient_scope"');
    return context.json(
      {
        success: false as const,
        message: 'This API token can only read; create a write token to make changes',
        code: 'TOKEN_SCOPE_INSUFFICIENT' as const,
      },
      403,
    );
  }
  const now = Date.now();
  // Throttled so API reads do not turn into a write per request.
  if (token.last_used_at === null || now - token.last_used_at >= API_TOKENS.TOUCH_INTERVAL_MS) touchApiToken(token.id, now);
  await next();
};

/** The account a public API request acts as, once `requireApiToken` admitted it. */
export interface ApiTokenAccount {
  id: string;
  name: string;
  email: string;
}

export function apiTokenAccount(context: Context): ApiTokenAccount | undefined {
  const outcome = outcomes.get(context);
  if (outcome?.kind !== 'active' || outcome.token.must_change_password === 1) return undefined;
  return { id: outcome.token.user_id, name: outcome.token.user_name, email: outcome.token.user_email };
}
