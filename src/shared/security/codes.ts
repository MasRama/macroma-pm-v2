/**
 * Refusal codes any Feature route under `/api` can answer with, whichever
 * Feature owns it: the shared guards and input validation, and the application
 * pipeline ahead of every route (CSRF, rate and body limits, the error handler, and the
 * password-change gate an Auth provider mounts). A Feature's contract adds its
 * own codes to these; the UI branches only on declared codes.
 *
 * Kept free of imports: contracts reach the browser bundle.
 */
export const API_REFUSAL_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'CSRF_INVALID',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'PASSWORD_CHANGE_REQUIRED',
  'APPLICATION_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ApiRefusalCode = (typeof API_REFUSAL_CODES)[number];

/**
 * Refusal codes the public API's bearer pipeline adds (`/api/v1`): the token
 * is malformed or unknown, expired, revoked, or its scope does not allow the
 * method. Every public API route can answer with these as well.
 */
export const API_TOKEN_REFUSAL_CODES = [
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'TOKEN_SCOPE_INSUFFICIENT',
] as const;

export type ApiTokenRefusalCode = (typeof API_TOKEN_REFUSAL_CODES)[number];
