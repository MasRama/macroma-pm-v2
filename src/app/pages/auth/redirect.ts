import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** Where to go after signing in: the `redirect` query when it is a same-site path, else the dashboard. */
export function redirectTarget(route: Pick<RouteLocationNormalizedLoaded, 'query'>): string {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) return redirect;
  return '/dashboard';
}
