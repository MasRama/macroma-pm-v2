import { describe, expect, it } from 'vitest';
import { openApiDocument, publicApiOperations } from '../openapi';
import { readApiDocs } from '../pages/api-docs/openapi-docs';
import fixture from './fixtures/openapi-v1.json';

/**
 * The Dokumentasi API tests and visual harness draw a fixture document. Its
 * GET operations are copies of the server's real ones, and this keeps them
 * so. Its write operations are samples, written before the server declared
 * any, so they are not compared.
 */
type Paths = Record<string, Record<string, unknown>>;

describe('API docs fixture', () => {
  const real = openApiDocument('/api/v1') as { paths: Paths; servers: unknown };
  const sample = fixture as unknown as { paths: Paths; servers: unknown };

  it('copies the server document for every read operation it lists', () => {
    const reads = Object.entries(sample.paths).flatMap(([path, methods]) => ('get' in methods ? [path] : []));
    expect(reads.length).toBeGreaterThan(0);
    for (const path of reads) expect(sample.paths[path].get, `GET ${path}`).toEqual(real.paths[path]?.get);
    expect(sample.servers).toEqual(real.servers);
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
    }
  });
});
