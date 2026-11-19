import { describe, expect, it } from 'vitest';
import { RATE_LIMIT } from '../../shared/config';
import { openApiDocument, publicApiOperations } from '../openapi';
import { readApiDocs } from '../pages/api-docs/openapi-docs';
import fixture from './fixtures/openapi-v1.json';

/**
 * The Dokumentasi API tests and visual harness draw a fixture document: a
 * part of the server's own, reads and writes. This keeps each operation it
 * lists equal to the server's, and checks the renderer reads the whole
 * server document.
 */
type Paths = Record<string, Record<string, unknown>>;
type Info = Record<string, unknown>;

describe('API docs fixture', () => {
  const real = openApiDocument('/api/v1', { requests: RATE_LIMIT.API_MAX_REQUESTS, windowMs: RATE_LIMIT.API_WINDOW_MS }) as {
    info: Info;
    paths: Paths;
    servers: unknown;
  };
  const sample = fixture as unknown as { info: Info; paths: Paths; servers: unknown };

  it('copies the server document for every operation it lists', () => {
    const listed = Object.entries(sample.paths).flatMap(([path, methods]) => Object.keys(methods).map((method) => [path, method] as const));
    expect(listed.map(([, method]) => method)).toEqual(expect.arrayContaining(['get', 'post', 'patch', 'delete']));
    for (const [path, method] of listed) expect(sample.paths[path][method], `${method} ${path}`).toEqual(real.paths[path]?.[method]);
    expect(sample.servers).toEqual(real.servers);
    expect(sample.info['x-rate-limit']).toEqual(real.info['x-rate-limit']);
  });

  it('lets the page renderer read the whole server document', () => {
    const docs = readApiDocs(real);
    const drawn = docs.groups.flatMap((group) => group.operations.map((operation) => `${group.tag} ${operation.method} ${operation.path}`));
    const declared = publicApiOperations().map(
      (operation) => `${operation.tag} ${operation.method.toUpperCase()} ${operation.path.replace(/:([A-Za-z_]+)/g, '{$1}')}`,
    );
    expect(drawn.sort()).toEqual(declared.sort());
    for (const operation of docs.groups.flatMap((group) => group.operations)) {
      expect(operation.scope, `${operation.method} ${operation.path}`).toBe(operation.method === 'GET' ? 'read' : 'write');
      expect(operation.summary).not.toBe(`${operation.method} ${operation.path}`);
      for (const refusal of operation.refusals) expect(refusal.codes, `${operation.method} ${operation.path} ${refusal.status}`).not.toEqual([]);
    }
  });

  it('sends a curl body every write endpoint accepts, and one that changes something', () => {
    const drawn = readApiDocs(real).groups.flatMap((group) => group.operations);
    const writes = publicApiOperations().filter((operation) => operation.body);
    expect(writes.length).toBeGreaterThan(0);
    for (const declared of writes) {
      const path = declared.path.replace(/:([A-Za-z_]+)/g, '{$1}');
      const operation = drawn.find((item) => item.method === declared.method.toUpperCase() && item.path === path)!;
      const parsed = declared.body!.safeParse(operation.bodyExample);
      expect(parsed.success, `${operation.method} ${path}: ${JSON.stringify(operation.bodyExample)}`).toBe(true);
      // The revision an edit is based on changes nothing by itself.
      expect(Object.keys(operation.bodyExample as object).filter((key) => key !== 'revision'), `${operation.method} ${path}`).not.toEqual([]);
    }
    // A new task sits in `backlog` (see "Create a task"), so moving it there again would be refused.
    const move = drawn.find((item) => item.method === 'PATCH' && item.path === '/tasks/{id}/move')!;
    expect(move.bodyExample).toEqual({ column_id: 'review' });
  });
});
