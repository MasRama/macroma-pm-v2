import type { RouteLocationNormalizedLoaded } from 'vue-router';

const DEFAULT_TARGET = '/dashboard';

/**
 * Backslashes and control characters, raw or percent-encoded: browsers read a
 * backslash as a slash and drop tabs and newlines, which can turn `/\evil.example`
 * or `/%09/evil.example` into a link to another site.
 */
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

function decoded(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Where to go after signing in: the `redirect` query when it is a same-site path, else the dashboard. */
export function redirectTarget(route: Pick<RouteLocationNormalizedLoaded, 'query'>): string {
  const redirect = route.query.redirect;
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) return DEFAULT_TARGET;
  const plain = decoded(redirect);
  if (plain === undefined || UNSAFE.test(redirect) || UNSAFE.test(plain)) return DEFAULT_TARGET;
  return redirect;
}
