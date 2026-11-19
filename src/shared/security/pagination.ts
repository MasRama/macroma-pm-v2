import { z } from 'zod';

/*
 * Keyset pagination for API lists. A page ends with `next_cursor`, an opaque
 * string naming the last item it returned by its sort value and id; the next
 * request sends it back as `cursor` and resumes right after that item, so
 * items written meanwhile neither repeat nor go missing. Browser-safe: no
 * Node built-ins.
 */

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

/** Where a page ended: the last item's sort value (ms epoch) and id. */
export interface PageCursor {
  at: number;
  id: string;
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

export function encodeCursor(cursor: PageCursor): string {
  return toBase64Url(JSON.stringify([cursor.at, cursor.id]));
}

/** The cursor a page returned, or undefined for anything else. */
export function decodeCursor(value: string): PageCursor | undefined {
  const text = fromBase64Url(value);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [at, id] = parsed as unknown[];
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return undefined;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return undefined;
  return { at, id };
}

/** The query fields every paginated list takes; a cursor it did not issue fails validation (422). */
export const pageQueryShape = {
  /** `next_cursor` from the previous page; without it, the first page. */
  cursor: z
    .string()
    .max(256)
    .transform((value, context) => {
      const cursor = decodeCursor(value);
      if (!cursor) {
        context.addIssue({ code: 'custom', message: 'Send back a next_cursor this list returned' });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
  /** Items per page. */
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
};

/**
 * One page from rows a query fetched with `LIMIT limit + 1`, in sort order:
 * the extra row only tells that another page follows.
 */
export function pageOf<T>(rows: readonly T[], limit: number, keyOf: (row: T) => PageCursor): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: [...rows], nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(keyOf(items[items.length - 1])) };
}

/**
 * One page of a short list already held in memory and sorted: the items
 * after `cursor` by `isAfter`, which must follow the list's own order.
 */
export function pageAfter<T>(
  items: readonly T[],
  page: { cursor?: PageCursor; limit: number },
  isAfter: (item: T, cursor: PageCursor) => boolean,
  keyOf: (item: T) => PageCursor,
): { items: T[]; nextCursor: string | null } {
  const { cursor } = page;
  const remaining = cursor ? items.filter((item) => isAfter(item, cursor)) : items;
  return pageOf(remaining.slice(0, page.limit + 1), page.limit, keyOf);
}

/** For lists sorted newest first, ties by id ascending: `created_at DESC, id`. */
export function newestFirstAfter(item: { created_at: number; id: string }, cursor: PageCursor): boolean {
  return item.created_at < cursor.at || (item.created_at === cursor.at && item.id > cursor.id);
}
