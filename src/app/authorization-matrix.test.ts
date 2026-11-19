import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app, PUBLIC_API_PREFIX, resetSecurityState } from './server';
import { TEMPORARY_PASSWORD_PATHS } from '../features/auth';
import { closeEventStreams } from '../shared/realtime';
import { apiRoutes, type ApiRoute } from '../shared/security';
import { csrfHeaders, issueCsrf } from '../shared/security/tests/helpers';
import { grantAdmin, grantPermissions, issueApiToken, requirePasswordChange, signUp, type Persona } from './tests/personas';

/**
 * Who may reach which API endpoint, derived from the routes the application
 * actually mounts and the rules their guards enforce, so a Feature's new
 * route is covered without editing this file.
 *
 * "Allowed" means authorization let the request through: the handler may still
 * answer 2xx, 404, 409, or 422, but never 401 or 403. Requests use empty
 * bodies and unknown targets so they cannot change the personas.
 */
const UNKNOWN_ID = 'f2a1c7de-0000-4000-8000-000000000000';

const AUTH_MOUNT = '/api/auth';
const temporaryPasswordPaths = new Set(TEMPORARY_PASSWORD_PATHS.map((path) => `${AUTH_MOUNT}${path}`));

const routes = apiRoutes(app);
const label = (route: ApiRoute) => `${route.method} ${route.path}`;
const target = (route: ApiRoute) => route.path.replace(/:[^/]+/g, UNKNOWN_ID);

const isPublicApi = (route: ApiRoute) => route.path.startsWith(`${PUBLIC_API_PREFIX}/`);
// Other cases revoke a persona's tokens (`POST /api/auth/tokens/revoke-all`),
// so each public API call gets a fresh one. A persona that must replace its
// temporary password cannot create tokens, so it keeps one made beforehand,
// which the administrator's reset revoked.
const keptTokens = new Map<string, string>();

async function keepToken(persona: Persona): Promise<Persona> {
  keptTokens.set(persona.id, await issueApiToken(persona, 'write'));
  return persona;
}

async function call(route: ApiRoute, persona?: Persona): Promise<{ status: number; code?: string }> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (isPublicApi(route)) {
    if (persona) headers.Authorization = `Bearer ${keptTokens.get(persona.id) ?? (await issueApiToken(persona, 'write'))}`;
    if (route.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = '{}';
    }
  } else if (route.method === 'GET') {
    if (persona) headers.Cookie = persona.cookie;
  } else {
    Object.assign(headers, csrfHeaders(await issueCsrf(app, persona?.cookie)), { 'Content-Type': 'application/json' });
    body = '{}';
  }
  const response = await app.request(target(route), { method: route.method, headers, body });
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    // An admitted live-update stream stays open; the status is the answer.
    await response.body?.cancel();
    return { status: response.status };
  }
  const payload = (await response.json().catch(() => ({}))) as { code?: string };
  return { status: response.status, code: payload.code };
}

function expectAllowed(result: { status: number; code?: string }): void {
  expect(result.status, `unexpected ${result.code ?? 'response'}`).not.toBe(401);
  expect(result.status, `unexpected ${result.code ?? 'response'}`).not.toBe(403);
  expect(result.status).toBeLessThan(500);
}

describe('API authorization matrix', () => {
  let member: Persona;
  let admin: Persona;
  let temporary: Persona;

  beforeAll(async () => {
    member = await signUp('Matrix Member');
    admin = await signUp('Matrix Admin');
    grantAdmin(admin.id);
    temporary = await keepToken(await signUp('Matrix Temporary'));
    grantAdmin(temporary.id);
    temporary = await requirePasswordChange(temporary);
  });

  // Public routes share the strict per-client limit; each case starts afresh.
  beforeEach(() => resetSecurityState());
  afterAll(() => closeEventStreams());

  it('covers every mounted API route, each declaring its access', () => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((route) => !route.access).map(label)).toEqual([]);
  });

  it('knows the rule every restricted route enforces', () => {
    const withoutRule = routes.filter((route) => route.access === 'restricted' && !route.rule).map(label);
    expect(withoutRule).toEqual([]);
  });

  for (const route of routes) {
    if (route.access === 'public') {
      // No sign-in is asked for; the handler may still refuse its input (an
      // avatar filename it does not recognise answers 403).
      it(`${label(route)} admits anonymous callers`, async () => {
        const result = await call(route);
        expect(result.status, `unexpected ${result.code ?? 'response'}`).not.toBe(401);
        expect(result.status).toBeLessThan(500);
      });
      continue;
    }

    it(`${label(route)} rejects anonymous callers with 401`, async () => {
      expect(await call(route)).toEqual({ status: 401, code: isPublicApi(route) ? 'TOKEN_INVALID' : 'UNAUTHORIZED' });
    });

    if (route.access === 'signed-in') {
      it(`${label(route)} admits any signed-in account`, async () => {
        expectAllowed(await call(route, member));
      });
    } else if (route.rule && 'permission' in route.rule) {
      const slug = route.rule.permission;
      it(`${label(route)} requires ${slug}`, async () => {
        expect(await call(route, member)).toEqual({ status: 403, code: 'FORBIDDEN' });

        const granted = await signUp(`Matrix ${slug}`);
        grantPermissions(granted.id, [slug]);
        expectAllowed(await call(route, granted));
      });
    } else {
      it(`${label(route)} requires an administrator`, async () => {
        expect(await call(route, member)).toEqual({ status: 403, code: 'FORBIDDEN' });
      });
    }

    it(`${label(route)} admits administrators`, async () => {
      expectAllowed(await call(route, admin));
    });

    if (temporaryPasswordPaths.has(route.path)) {
      it(`${label(route)} stays reachable with a temporary password`, async () => {
        expectAllowed(await call(route, temporary));
      });
    } else {
      it(`${label(route)} is blocked until a temporary password is replaced`, async () => {
        // The reset that set the temporary password also revoked every token of the account.
        const blocked = isPublicApi(route) ? { status: 401, code: 'TOKEN_REVOKED' } : { status: 403, code: 'PASSWORD_CHANGE_REQUIRED' };
        expect(await call(route, temporary)).toEqual(blocked);
      });
    }
  }
});
