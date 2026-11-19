import { z } from 'zod';
import { projectsApiV1, PROJECTS_REFUSAL_CODES } from '../features/projects';
import { workspacesApiV1, WORKSPACES_REFUSAL_CODES } from '../features/workspaces';
import type { ApiOperation } from '../shared/security';
import { API_REFUSAL_CODES, API_TOKEN_REFUSAL_CODES } from '../shared/security/codes';

/*
 * The public API's OpenAPI 3.1 document, built from the operations each
 * Feature's contract declares. A test checks those operations against the
 * routes actually mounted, so the document cannot drift from the server.
 */

export interface PublicApiOperation extends ApiOperation {
  /** Groups the operation in the document: its first path segment, as `Projects`. */
  tag: string;
}

function tagOf(path: string): string {
  const segment = path.split('/')[1] ?? '';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/** Every operation of the public API, as its Features declare them. */
export function publicApiOperations(): PublicApiOperation[] {
  return [...workspacesApiV1(), ...projectsApiV1()].map((operation) => ({ ...operation, tag: tagOf(operation.path) }));
}

type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io }) as JsonSchema;
  return rest;
}

const READ_METHODS = new Set(['get']);

/** The refusals an operation can answer with, by status: the pipeline's, then its Feature's. */
function refusalsOf(operation: ApiOperation): Map<number, string[]> {
  const refusals = new Map<number, string[]>();
  const add = (status: number, codes: readonly string[]) => refusals.set(status, [...(refusals.get(status) ?? []), ...codes]);
  add(401, ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED']);
  add(403, READ_METHODS.has(operation.method) ? ['PASSWORD_CHANGE_REQUIRED'] : ['PASSWORD_CHANGE_REQUIRED', 'TOKEN_SCOPE_INSUFFICIENT']);
  for (const [status, codes] of Object.entries(operation.refusals ?? {})) add(Number(status), codes ?? []);
  if (operation.body) add(413, ['PAYLOAD_TOO_LARGE']);
  if (operation.query || operation.body) add(422, ['VALIDATION_ERROR']);
  add(429, ['RATE_LIMITED']);
  for (const [status, codes] of refusals) refusals.set(status, [...new Set(codes)]);
  return new Map([...refusals].sort(([left], [right]) => left - right));
}

function parameters(operation: ApiOperation): JsonSchema[] {
  const path = [...operation.path.matchAll(/:([A-Za-z_]+)/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (!operation.query) return path;
  const query = jsonSchema(operation.query, 'input') as { properties?: Record<string, JsonSchema>; required?: string[] };
  return [
    ...path,
    ...Object.entries(query.properties ?? {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: query.required?.includes(name) ?? false,
      ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
      schema,
    })),
  ];
}

const ERROR_REFERENCE = { $ref: '#/components/schemas/Error' };

function operationObject(operation: PublicApiOperation): JsonSchema {
  const responses: Record<string, JsonSchema> = {};
  for (const [status, schema] of Object.entries(operation.responses)) {
    responses[status] = { description: 'OK', content: { 'application/json': { schema: jsonSchema(schema, 'output') } } };
  }
  for (const [status, codes] of refusalsOf(operation)) {
    responses[String(status)] = {
      description: `Refused: ${codes.join(', ')}`,
      content: {
        'application/json': { schema: { allOf: [ERROR_REFERENCE, { properties: { code: { enum: codes } } }] } },
      },
    };
  }
  return {
    operationId: `${operation.method}${operation.path.replace(/\/:?([A-Za-z_]+)/g, (_match, part: string) => part.charAt(0).toUpperCase() + part.slice(1))}`,
    tags: [operation.tag],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    parameters: parameters(operation),
    ...(operation.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(operation.body, 'input') } } } }
      : {}),
    responses,
  };
}

/** The OpenAPI 3.1 document of the public API mounted at `prefix`. */
export function openApiDocument(prefix: string): JsonSchema {
  const operations = publicApiOperations();
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const operation of operations) {
    const path = operation.path.replace(/:([A-Za-z_]+)/g, '{$1}');
    paths[path] = { ...paths[path], [operation.method]: operationObject(operation) };
  }
  const error = z.strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.enum([...new Set([...API_REFUSAL_CODES, ...API_TOKEN_REFUSAL_CODES, ...WORKSPACES_REFUSAL_CODES, ...PROJECTS_REFUSAL_CODES])]),
    /** Validation failures by field. */
    errors: z.record(z.string(), z.array(z.string())).optional(),
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Macroma public API',
      version: '1',
      description:
        'Read and change Macroma workspaces, projects and tasks from your own tools. Authenticate with a personal access token as a Bearer token; a `read` token may only use GET.',
    },
    servers: [{ url: prefix }],
    security: [{ bearerAuth: [] }],
    tags: [...new Set(operations.map((operation) => operation.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'A personal access token (`mcr_…`), created while signed in to Macroma.',
        },
      },
      schemas: { Error: jsonSchema(error, 'output') },
    },
  };
}
