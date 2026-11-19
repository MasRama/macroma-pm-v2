import type { ApiTokenData, ApiTokenScope } from '../contract';

/*
 * Shapes the API token screen renders. API rows become these only through
 * the mapper below; the page never reads API rows. Times arrive as epoch
 * milliseconds and leave as ISO strings, like every other date the UI formats.
 */

export interface ApiTokenView {
  id: string;
  name: string;
  /** `mcr_` and the secret's next characters; enough to tell tokens apart, never the secret. */
  prefix: string;
  scope: ApiTokenScope;
  createdAt: string;
  /** `null`: the token never expires. */
  expiresAt: string | null;
  /** `null`: never used yet. */
  lastUsedAt: string | null;
  /** Past its expiry: listed until it is purged, but refused by the API. */
  expired: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function toApiTokenView(row: ApiTokenData): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdAt: iso(row.createdAt),
    expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
    lastUsedAt: row.lastUsedAt === null ? null : iso(row.lastUsedAt),
    expired: row.expired,
  };
}

/**
 * Whether the signed-in account confirms new tokens with its password. Only
 * an explicit `hasPassword: false` (an account made through Google) hides the
 * field; a session that does not say keeps it, and the server decides.
 */
export function accountHasPassword(user: { hasPassword?: boolean } | null | undefined): boolean {
  return user?.hasPassword !== false;
}
