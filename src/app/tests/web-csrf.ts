import { csrfHeaders, ensureCsrfToken } from '../../features/auth/web';

/**
 * The CSRF provider a page hands a Feature's web client, bound to Auth the way
 * the application's web bindings do, for contract tests of Features without pages.
 */
export const webCsrf = {
  headers: (extra?: HeadersInit) => csrfHeaders(extra),
  ensureToken: () => ensureCsrfToken(),
};
