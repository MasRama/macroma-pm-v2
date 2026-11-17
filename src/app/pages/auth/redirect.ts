import type { RouteLocationNormalizedLoaded } from 'vue-router';

/** Where to go after signing in: the `redirect` query when it is a same-site path, else the dashboard. */
export function redirectTarget(route: RouteLocationNormalizedLoaded): string {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) return redirect;
  return '/dashboard';
}

/** First server message per field, for the form's error slots. */
export function firstErrors(errors: Record<string, string[]> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(errors ?? {})) if (messages[0]) result[key] = messages[0];
  return result;
}
