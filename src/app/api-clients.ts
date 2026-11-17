import { csrfHeaders, ensureCsrfToken } from '../features/auth/web';
import { createWorkspacesClient } from '../features/workspaces/web';

/** CSRF for the Feature clients the app shell and pages share, bound to Auth's token. */
export const webCsrf = { headers: (extra?: HeadersInit) => csrfHeaders(extra), ensureToken: () => ensureCsrfToken() };

export const workspacesClient = createWorkspacesClient({ csrf: webCsrf });
