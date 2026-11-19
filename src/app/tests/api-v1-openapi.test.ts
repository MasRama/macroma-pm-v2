import { describe, expect, it } from 'vitest';
import { env } from '../../shared/config';
import { apiRoutes } from '../../shared/security';
import { API_REFUSAL_CODES, API_TOKEN_REFUSAL_CODES } from '../../shared/security/codes';
import { PROJECTS_REFUSAL_CODES } from '../../features/projects';
import { WORKSPACES_REFUSAL_CODES } from '../../features/workspaces';
import { publicApiOperations } from '../openapi';
import { app, PUBLIC_API_PREFIX, PUBLIC_API_SPEC_PATH } from '../server';

/**
 * The OpenAPI document of the public API: served without a token, and
 * describing exactly the routes mounted under `/api/v1`. The read and write
 * tests parse every real answer with the schemas it documents.
 */
type Document = {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, Record<string, { parameters: Array<{ name: string; in: string }>; responses: Record<string, unknown> }>>;
  components: { schemas: { Error: { properties: { code: { enum: string[] } } } }; securitySchemes: Record<string, unknown> };
  security: unknown[];
};

async function fetchDocument(headers: Record<string, string> = {}) {
  const response = await app.request(PUBLIC_API_SPEC_PATH, { headers });
  return { response, document: (await response.json()) as Document };
}

describe('public API OpenAPI document', () => {
  it('is served to anyone, without a token and without a cookie', async () => {
    const { response, document } = await fetchDocument();
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(document.openapi).toBe('3.1.0');
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    // The limit each token gets, as the public API's limiter is configured.
    expect(document.info['x-rate-limit']).toEqual({ requests: env.API_RATE_LIMIT_MAX, window_seconds: env.API_RATE_LIMIT_WINDOW_MS / 1000 });

    // A token, even a made-up one, changes nothing about this one path.
    expect((await fetchDocument({ Authorization: 'Bearer nonsense' })).response.status).toBe(200);
  });

  it('documents exactly the routes mounted under /api/v1', () => {
    const mounted = apiRoutes(app, PUBLIC_API_PREFIX)
      .filter((route) => route.path !== PUBLIC_API_SPEC_PATH)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    const documented = publicApiOperations()
      .map((operation) => `${operation.method.toUpperCase()} ${PUBLIC_API_PREFIX}${operation.path}`)
      .sort();
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted).toEqual(documented);
  });

  it('lists every operation once, with its path parameters and refusals', async () => {
    const { document } = await fetchDocument();
    const operations = publicApiOperations();
    expect(Object.values(document.paths).flatMap((methods) => Object.keys(methods))).toHaveLength(operations.length);
    for (const operation of operations) {
      const path = operation.path.replace(/:([A-Za-z_]+)/g, '{$1}');
      const entry = document.paths[path]?.[operation.method];
      expect(entry, `${operation.method} ${path}`).toBeDefined();
      const pathNames = [...operation.path.matchAll(/:([A-Za-z_]+)/g)].map(([, name]) => name);
      expect(entry.parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name)).toEqual(pathNames);
      const successes = Object.keys(operation.responses);
      expect(Object.keys(entry.responses)).toEqual(expect.arrayContaining([...successes, '401', '403', '429']));
      const answers = entry.responses as Record<string, { description: string; content: { 'application/json': { schema: any } } }>;
      // Every refusal names its codes; a stale edit's 409 also documents the record it carries back.
      const codesOf = (status: string) => answers[status]?.description.replace(/^Refused: /, '').split(', ');
      const refusedSchemaOf = (status: string) => answers[status]?.content['application/json'].schema;
      expect(codesOf('401')).toEqual(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED']);
      expect(refusedSchemaOf('401').allOf[1].properties.code.enum).toEqual(codesOf('401'));
      expect(codesOf('403')).toContain('PASSWORD_CHANGE_REQUIRED');
      if (operation.method === 'get') expect(codesOf('403')).not.toContain('TOKEN_SCOPE_INSUFFICIENT');
      else expect(codesOf('403')).toContain('TOKEN_SCOPE_INSUFFICIENT');
      for (const [status, codes] of Object.entries(operation.refusals ?? {})) {
        expect(codesOf(status), `${path} ${status}`).toEqual(expect.arrayContaining([...(codes ?? [])]));
      }
      if (operation.query || operation.body) expect(codesOf('422')).toEqual(['VALIDATION_ERROR']);
      if (operation.stale) {
        expect(refusedSchemaOf('409'), path).toMatchObject({ properties: { code: { const: 'STALE_REVISION' }, current: { type: 'object' } } });
      }
    }
  });

  it('documents each write\'s request body', async () => {
    const { document } = await fetchDocument();
    const writes = publicApiOperations().filter((operation) => operation.method !== 'get');
    expect(writes.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual([
      'delete /tasks/:id',
      'patch /tasks/:id',
      'patch /tasks/:id/move',
      'post /projects/:id/tasks',
      'post /tasks/:id/comments',
    ]);
    for (const operation of writes) {
      const entry = document.paths[operation.path.replace(/:([A-Za-z_]+)/g, '{$1}')][operation.method] as { requestBody?: any };
      if (operation.method === 'delete') expect(entry.requestBody).toBeUndefined();
      else expect(entry.requestBody?.content['application/json'].schema.type, operation.path).toBe('object');
    }
  });

  it('declares every code a public API route can answer with', async () => {
    const { document } = await fetchDocument();
    expect(document.components.schemas.Error.properties.code.enum.sort()).toEqual(
      [...new Set([...API_REFUSAL_CODES, ...API_TOKEN_REFUSAL_CODES, ...WORKSPACES_REFUSAL_CODES, ...PROJECTS_REFUSAL_CODES])].sort(),
    );
  });
});
