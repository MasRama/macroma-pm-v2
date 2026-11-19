import { z } from 'zod';
import { readFeatureEnv } from '../../../shared/config';

const environment = readFeatureEnv('auth', {
  AUTH_LOCKOUT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
});

export const AUTH = {
  SESSION_EXPIRY_MS: 60 * 24 * 60 * 60 * 1000,
  /** Oldest sessions beyond this per-account cap are revoked on sign-in. */
  MAX_SESSIONS_PER_USER: 10,
  /** last_seen_at is written at most once per interval per session. */
  SESSION_TOUCH_INTERVAL_MS: 5 * 60 * 1000,
  TWO_FACTOR_ISSUER: 'Nara',
  TWO_FACTOR_CHALLENGE_TTL_MS: 5 * 60 * 1000,
  TWO_FACTOR_MAX_ATTEMPTS: 5,
  /** Failed sign-ins per normalized email or per IP before that dimension locks. */
  LOCKOUT_ATTEMPTS: environment.AUTH_LOCKOUT_ATTEMPTS,
  LOCKOUT_WINDOW_MS: environment.AUTH_LOCKOUT_WINDOW_MS,
} as const;

// Empty values count as unset, so `GOOGLE_CLIENT_ID=` in a copied example
// file leaves Google sign-in off instead of half-configured.
const setting = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const integrations = readFeatureEnv('auth', {
  GOOGLE_CLIENT_ID: setting,
  GOOGLE_CLIENT_SECRET: setting,
  GOOGLE_REDIRECT_URI: setting,
  MAIL_HOST: setting,
  MAIL_PORT: z.coerce.number().int().positive().default(587),
  MAIL_SECURE: z.enum(['true', 'false']).optional(),
  MAIL_USER: setting,
  MAIL_PASSWORD: setting,
  MAIL_FROM: setting,
});

/**
 * Google sign-in. It is on only when all three are set; the routes answer 404
 * otherwise. Read on every request, so a test may set them.
 */
export const GOOGLE: { clientId?: string; clientSecret?: string; redirectUri?: string } = {
  clientId: integrations.GOOGLE_CLIENT_ID,
  clientSecret: integrations.GOOGLE_CLIENT_SECRET,
  redirectUri: integrations.GOOGLE_REDIRECT_URI,
};

/** Outgoing mail over SMTP. Without a host, mail is written to the log instead. */
export const MAIL = {
  host: integrations.MAIL_HOST,
  port: integrations.MAIL_PORT,
  /** Implicit TLS; defaults to on for port 465, STARTTLS otherwise. */
  secure: integrations.MAIL_SECURE === undefined ? integrations.MAIL_PORT === 465 : integrations.MAIL_SECURE === 'true',
  user: integrations.MAIL_USER,
  password: integrations.MAIL_PASSWORD,
  from: integrations.MAIL_FROM ?? 'Macroma <no-reply@localhost>',
} as const;

/** How long an emailed password reset link works. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** How long a Google sign-in may take between leaving and coming back. */
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;

/** How often the application should remove expired sessions. */
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Personal access tokens for the public API. */
export const API_TOKENS = {
  /** Every secret starts with it, so leaked tokens are easy to spot and scan for. */
  PREFIX: 'mcr_',
  /** Characters of the secret kept to tell tokens apart: the prefix and six more. */
  DISPLAY_LENGTH: 10,
  /** Working (not revoked, not expired) tokens one account may hold. */
  MAX_ACTIVE_PER_USER: 50,
  /** last_used_at is written at most once per interval per token. */
  TOUCH_INTERVAL_MS: 60 * 1000,
  /** How long revoked and expired tokens keep answering why before they are removed. */
  PURGE_AFTER_MS: 30 * 24 * 60 * 60 * 1000,
} as const;
