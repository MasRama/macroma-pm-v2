import type { z } from 'zod';

/**
 * One documented operation of a public API, declared by the Feature that
 * serves it. The application turns the list into its OpenAPI document and a
 * test checks it against the routes actually mounted, so the two cannot
 * drift. Browser-safe: types only.
 */
export interface ApiOperation {
  method: 'get' | 'post' | 'patch' | 'delete';
  /** As mounted, relative to the API's prefix, in Hono's syntax: `/projects/:id`. */
  path: string;
  summary: string;
  description?: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The success answers by status. */
  responses: Readonly<Record<number, z.ZodType>>;
  /** The Feature's own refusals by status, beyond those every operation can answer. */
  refusals?: Readonly<Partial<Record<403 | 404 | 409 | 422, readonly string[]>>>;
}
