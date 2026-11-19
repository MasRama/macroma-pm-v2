import type { MaintenanceTask } from '../../../shared/database';
import { API_TOKENS, SESSION_CLEANUP_INTERVAL_MS } from './config';
import { cleanupExpiredSessions, purgeApiTokens } from './repository';

/** Auth's upkeep on its own tables; the application starts it after migrations. */
export const AUTH_MAINTENANCE: readonly MaintenanceTask[] = [
  {
    name: 'expired-sessions',
    everyMs: SESSION_CLEANUP_INTERVAL_MS,
    run: (now) => {
      const removed = cleanupExpiredSessions(now);
      return removed > 0 ? { removed } : undefined;
    },
  },
  {
    // Revoked and expired API tokens answer why they stopped working for a
    // while, then go.
    name: 'stale-api-tokens',
    everyMs: SESSION_CLEANUP_INTERVAL_MS,
    run: (now) => {
      const removed = purgeApiTokens(now - API_TOKENS.PURGE_AFTER_MS);
      return removed > 0 ? { removed } : undefined;
    },
  },
];
