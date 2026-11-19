/*
 * Turns the public API's OpenAPI 3.1 document (GET /api/v1/openapi.json) into
 * what the Dokumentasi API page draws: endpoints grouped by tag, their
 * parameters, body and response fields, the scope they need and a curl
 * example. Nothing here knows a Macroma endpoint; every endpoint comes from
 * the document, so new operations show up without a change here.
 */

type Schema = Record<string, unknown>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type TokenScope = 'read' | 'write';

/** One row of a field list; nested fields follow their parent with a larger depth. */
export interface DocField {
  /** Dotted path from the top, `tasks[].assignee.id`: unique within its list. */
  path: string;
  name: string;
  depth: number;
  type: string;
  required: boolean;
  description?: string;
  /** Allowed values of an enum. */
  values?: string[];
  /** The value used when the field is left out. */
  fallback?: string;
}

export interface DocParam {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  type: string;
  description?: string;
  values?: string[];
  fallback?: string;
  /** Limits worth knowing, as `1–100` or `maks. 64 karakter`. */
  limits?: string;
}

export interface DocRefusal {
  status: number;
  codes: string[];
}

export interface DocOperation {
  /** The anchor of its card on the page. */
  id: string;
  method: HttpMethod;
  /** Relative to the base URL, as the document lists it: `/projects/{id}/tasks`. */
  path: string;
  summary: string;
  description?: string;
  scope: TokenScope;
  params: DocParam[];
  /** Fields of the JSON body, or null when the operation takes none. */
  body: DocField[] | null;
  /** The success status and the fields of its `data`. */
  status: number;
  response: DocField[];
  refusals: DocRefusal[];
  /** Body a curl example sends: the required fields with values the schema accepts, and a change when an edit needs one. */
  bodyExample: unknown;
}

export interface DocGroup {
  id: string;
  tag: string;
  description?: string;
  operations: DocOperation[];
}

export interface DocPagination {
  limitMin?: number;
  limitMax?: number;
  limitDefault?: number;
}

/** How many requests a token may make in a window (`info.x-rate-limit`), and the code past it. */
export interface DocRateLimit {
  requests: number;
  windowSeconds: number;
  /** The 429 refusal's code. */
  code?: string;
}

export interface ApiDocs {
  title: string;
  description?: string;
  /** `servers[0].url` as the document gives it; may be relative to the site. */
  server?: string;
  /** The bearer scheme's description, when the document declares one. */
  bearer?: { description?: string };
  groups: DocGroup[];
  /** Set when lists take `cursor` and `limit`. */
  pagination: DocPagination | null;
  /** An example refusal built from `components.schemas.Error`, with the code a request without a valid token gets. */
  errorExample: unknown;
  rateLimit: DocRateLimit | null;
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** How deep field lists go; deeper objects show as one `object` row. */
const MAX_DEPTH = 5;

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Follows a local `$ref` (`#/components/schemas/Error`); anything else stays as it is. */
function resolve(spec: Schema, schema: unknown, seen = new Set<string>()): Schema {
  if (!isRecord(schema)) return {};
  const ref = asString(schema.$ref);
  if (!ref || !ref.startsWith('#/') || seen.has(ref)) return schema;
  let target: unknown = spec;
  for (const part of ref.slice(2).split('/')) target = isRecord(target) ? target[part] : undefined;
  return resolve(spec, target, new Set([...seen, ref]));
}

/** `allOf` parts merged into one object schema, so an Error with a narrowed `code` reads as one. */
function flatten(spec: Schema, schema: unknown): Schema {
  const own = resolve(spec, schema);
  if (!Array.isArray(own.allOf)) return own;
  const merged: Schema = { ...own, allOf: undefined, properties: {}, required: [] };
  for (const part of own.allOf.map((item) => flatten(spec, item))) {
    for (const [name, value] of Object.entries(isRecord(part.properties) ? part.properties : {})) {
      const properties = merged.properties as Schema;
      properties[name] = { ...(isRecord(properties[name]) ? properties[name] : {}), ...(isRecord(value) ? value : {}) };
    }
    merged.required = [...(merged.required as string[]), ...(Array.isArray(part.required) ? part.required : [])];
    for (const key of ['type', 'description', 'additionalProperties'] as const) if (part[key] !== undefined) merged[key] = part[key];
  }
  return merged;
}

function typesOf(schema: Schema): string[] {
  if (Array.isArray(schema.type)) return schema.type.filter((item): item is string => typeof item === 'string');
  return typeof schema.type === 'string' ? [schema.type] : [];
}

/** The object or array a nullable field holds: the `anyOf` member that is not `null`. */
function nonNull(spec: Schema, schema: Schema): Schema {
  const options = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (!options) return schema;
  const real = options.map((option) => flatten(spec, option)).filter((option) => !typesOf(option).every((type) => type === 'null'));
  return real.length === 1 ? real[0] : schema;
}

/** A short type label: `string`, `string | null`, `object[]`, `"low" | …` stays `string`. */
export function typeLabel(spec: Schema, raw: unknown): string {
  const schema = flatten(spec, raw);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const options = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (options) return [...new Set(options.map((option) => typeLabel(spec, option)))].join(' | ');
  const types = typesOf(schema);
  if (types.length === 0) return isRecord(schema.properties) ? 'object' : 'any';
  return types
    .map((type) => {
      if (type !== 'array') return type;
      const item = typeLabel(spec, schema.items);
      return item.includes(' | ') ? `(${item})[]` : `${item}[]`;
    })
    .join(' | ');
}

function valuesOf(schema: Schema): string[] | undefined {
  return Array.isArray(schema.enum) ? schema.enum.map((value) => String(value)) : undefined;
}

function fallbackOf(schema: Schema): string | undefined {
  return schema.default === undefined ? undefined : JSON.stringify(schema.default);
}

/** The rows of an object's properties, nested objects and arrays of objects expanded below them. */
export function fieldsOf(spec: Schema, raw: unknown, prefix = '', depth = 0): DocField[] {
  const schema = flatten(spec, raw);
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(properties).flatMap(([name, value]) => {
    const own = flatten(spec, value);
    const path = prefix ? `${prefix}.${name}` : name;
    const field: DocField = {
      path,
      name,
      depth,
      type: typeLabel(spec, value),
      required: required.has(name),
      ...(asString(own.description) ? { description: own.description as string } : {}),
      ...(valuesOf(own) ? { values: valuesOf(own) } : {}),
      ...(fallbackOf(own) ? { fallback: fallbackOf(own) } : {}),
    };
    if (depth + 1 >= MAX_DEPTH) return [field];
    const inner = nonNull(spec, own);
    if (isRecord(inner.properties)) return [field, ...fieldsOf(spec, inner, path, depth + 1)];
    const items = typesOf(inner).includes('array') ? nonNull(spec, flatten(spec, inner.items)) : null;
    if (items && isRecord(items.properties)) return [field, ...fieldsOf(spec, items, `${path}[]`, depth + 1)];
    return [field];
  });
}

function limitsOf(schema: Schema): string | undefined {
  const { minimum, maximum, minLength, maxLength } = schema;
  if (typeof minimum === 'number' && typeof maximum === 'number' && maximum < Number.MAX_SAFE_INTEGER) return `${minimum}–${maximum}`;
  if (typeof minimum === 'number' && minimum > 0) return `min. ${minimum}`;
  if (typeof maxLength === 'number') return typeof minLength === 'number' && minLength > 1 ? `${minLength}–${maxLength} karakter` : `maks. ${maxLength} karakter`;
  return undefined;
}

function paramsOf(spec: Schema, operation: Schema): DocParam[] {
  const list = Array.isArray(operation.parameters) ? operation.parameters : [];
  return list
    .map((item) => resolve(spec, item))
    .filter((item) => item.in === 'path' || item.in === 'query')
    .map((item) => {
      const schema = flatten(spec, item.schema);
      const description = asString(item.description) ?? asString(schema.description);
      return {
        name: String(item.name),
        in: item.in as 'path' | 'query',
        required: item.required === true,
        type: typeLabel(spec, item.schema),
        ...(description ? { description } : {}),
        ...(valuesOf(schema) ? { values: valuesOf(schema) } : {}),
        ...(fallbackOf(schema) ? { fallback: fallbackOf(schema) } : {}),
        ...(limitsOf(schema) ? { limits: limitsOf(schema) } : {}),
      };
    });
}

function jsonSchemaOf(spec: Schema, holder: unknown): Schema | null {
  const content = resolve(spec, holder).content;
  if (!isRecord(content)) return null;
  const json = content['application/json'];
  return isRecord(json) && json.schema !== undefined ? flatten(spec, json.schema) : null;
}

/** Fields of a success answer's `data`; an envelope without `data` has none. */
function responseFields(spec: Schema, schema: Schema | null): DocField[] {
  if (!schema) return [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if ('success' in properties) return 'data' in properties ? fieldsOf(spec, properties.data) : [];
  return fieldsOf(spec, schema);
}

function refusalsOf(spec: Schema, responses: Schema): DocRefusal[] {
  return Object.entries(responses)
    .filter(([status]) => Number(status) >= 400)
    .map(([status, answer]) => {
      const schema = jsonSchemaOf(spec, answer);
      const code = isRecord(schema?.properties) ? flatten(spec, schema.properties.code) : {};
      // A status with one refusal names it as a const, several as an enum.
      const codes = valuesOf(code) ?? (code.const === undefined ? [] : [String(code.const)]);
      return { status: Number(status), codes };
    })
    .sort((left, right) => left.status - right.status);
}

/**
 * The scope a token needs. The document says it through the refusals: an
 * operation a `read` token may not use can answer `TOKEN_SCOPE_INSUFFICIENT`.
 * Without that, only GET and HEAD are reads.
 */
function scopeOf(method: HttpMethod, refusals: DocRefusal[]): TokenScope {
  const codes = refusals.flatMap((refusal) => refusal.codes);
  if (codes.includes('TOKEN_SCOPE_INSUFFICIENT')) return 'write';
  if (refusals.some((refusal) => refusal.status === 403)) return 'read';
  return method === 'GET' ? 'read' : 'write';
}

/** The smallest number the schema accepts: its `minimum`, just above its `exclusiveMinimum`, or 0. */
function lowestOf(schema: Schema, integer: boolean): number {
  const bounds: number[] = [];
  if (typeof schema.minimum === 'number') bounds.push(integer ? Math.ceil(schema.minimum) : schema.minimum);
  if (typeof schema.exclusiveMinimum === 'number') bounds.push(integer ? Math.floor(schema.exclusiveMinimum) + 1 : schema.exclusiveMinimum + 1);
  return bounds.length ? Math.max(...bounds) : 0;
}

/**
 * A value the schema accepts: a const, the document's own example, the
 * default, the first allowed value, the smallest number, or `<name>`.
 */
export function exampleOf(spec: Schema, raw: unknown, name = 'value', depth = 0, onlyRequired = false): unknown {
  const schema = nonNull(spec, flatten(spec, raw));
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  const values = Array.isArray(schema.enum) ? schema.enum : null;
  if (values?.length) return values[0];
  const types = typesOf(schema).filter((type) => type !== 'null');
  const type = types[0] ?? (isRecord(schema.properties) ? 'object' : 'string');
  if (depth > MAX_DEPTH) return null;
  switch (type) {
    case 'integer':
    case 'number':
      return lowestOf(schema, type === 'integer');
    case 'boolean':
      return false;
    case 'array':
      return [exampleOf(spec, schema.items, name, depth + 1)];
    case 'object': {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const names = Object.keys(properties).filter((key) => !onlyRequired || required.has(key));
      const picked = names.length ? names : Object.keys(properties);
      if (picked.length === 0 && isRecord(schema.additionalProperties)) {
        return { field: exampleOf(spec, schema.additionalProperties, 'message', depth + 1) };
      }
      return Object.fromEntries(picked.map((key) => [key, exampleOf(spec, properties[key], key, depth + 1)]));
    }
    default:
      return `<${name}>`;
  }
}

/**
 * The body a curl example sends: the required fields. An edit whose only
 * required field is the `revision` it is based on would change nothing, so it
 * also sends the first optional field.
 */
function bodyExampleOf(spec: Schema, body: Schema): unknown {
  const example = exampleOf(spec, body, 'body', 0, true);
  if (!isRecord(example) || Object.keys(example).some((key) => key !== 'revision')) return example;
  const properties = isRecord(body.properties) ? body.properties : {};
  const change = Object.keys(properties).find((key) => !(key in example));
  return change ? { ...example, [change]: exampleOf(spec, properties[change], change, 1) } : example;
}

function operationOf(spec: Schema, method: HttpMethod, path: string, operation: Schema): DocOperation {
  const responses = isRecord(operation.responses) ? operation.responses : {};
  const success = Object.keys(responses)
    .map(Number)
    .filter((status) => status >= 200 && status < 300)
    .sort((left, right) => left - right)[0];
  const refusals = refusalsOf(spec, responses);
  const body = operation.requestBody ? jsonSchemaOf(spec, operation.requestBody) : null;
  const description = asString(operation.description);
  return {
    id: `op-${slug(asString(operation.operationId) ?? `${method}-${path}`)}`,
    method,
    path,
    summary: asString(operation.summary) ?? `${method} ${path}`,
    ...(description ? { description } : {}),
    scope: scopeOf(method, refusals),
    params: paramsOf(spec, operation),
    body: body ? fieldsOf(spec, body) : null,
    status: success ?? 200,
    response: success === undefined ? [] : responseFields(spec, jsonSchemaOf(spec, responses[String(success)])),
    refusals,
    bodyExample: body ? bodyExampleOf(spec, body) : undefined,
  };
}

function paginationOf(groups: DocGroup[]): DocPagination | null {
  const params = groups.flatMap((group) => group.operations.flatMap((operation) => operation.params));
  if (!params.some((param) => param.in === 'query' && param.name === 'cursor')) return null;
  return { ...limitOf(params.find((param) => param.in === 'query' && param.name === 'limit')) };
}

function rateLimitOf(info: Schema, groups: DocGroup[]): DocRateLimit | null {
  const limit = isRecord(info['x-rate-limit']) ? info['x-rate-limit'] : null;
  if (!limit || typeof limit.requests !== 'number' || typeof limit.window_seconds !== 'number') return null;
  const code = groups.flatMap((group) => group.operations.flatMap((operation) => operation.refusals)).find((refusal) => refusal.status === 429)?.codes[0];
  return { requests: limit.requests, windowSeconds: limit.window_seconds, ...(code ? { code } : {}) };
}

/** The example refusal: the envelope's required fields, with the code a missing or wrong token gets (the first 401). */
function errorExampleOf(spec: Schema, schema: unknown, groups: DocGroup[]): unknown {
  if (schema === undefined) return null;
  const example = exampleOf(spec, schema, 'error', 0, true);
  const code = groups.flatMap((group) => group.operations.flatMap((operation) => operation.refusals)).find((refusal) => refusal.status === 401)?.codes[0];
  return code && isRecord(example) && 'code' in example ? { ...example, code } : example;
}

function limitOf(param: DocParam | undefined): DocPagination {
  if (!param) return {};
  const [min, max] = param.limits?.split('–').map(Number) ?? [];
  return {
    ...(Number.isFinite(min) ? { limitMin: min } : {}),
    ...(Number.isFinite(max) ? { limitMax: max } : {}),
    ...(param.fallback !== undefined && Number.isFinite(Number(param.fallback)) ? { limitDefault: Number(param.fallback) } : {}),
  };
}

/** Throws when the value is not an OpenAPI document with paths. */
export function readApiDocs(value: unknown): ApiDocs {
  if (!isRecord(value) || typeof value.openapi !== 'string' || !isRecord(value.paths)) {
    throw new Error('Not an OpenAPI document');
  }
  const spec = value;
  const info = isRecord(spec.info) ? spec.info : {};
  const declaredTags = (Array.isArray(spec.tags) ? spec.tags : []).filter(isRecord);
  const groups = new Map<string, DocGroup>();
  const groupOf = (tag: string) => {
    let group = groups.get(tag);
    if (!group) {
      const declared = declaredTags.find((item) => item.name === tag);
      const description = asString(declared?.description);
      group = { id: `tag-${slug(tag)}`, tag, ...(description ? { description } : {}), operations: [] };
      groups.set(tag, group);
    }
    return group;
  };
  // Declared tags keep their order; untagged operations land in "Lainnya".
  for (const tag of declaredTags) if (typeof tag.name === 'string') groupOf(tag.name);
  for (const [path, item] of Object.entries(spec.paths as Schema)) {
    if (!isRecord(item)) continue;
    for (const method of METHODS) {
      const operation = item[method.toLowerCase()];
      if (!isRecord(operation)) continue;
      const tags = Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === 'string') : [];
      groupOf(tags[0] ?? 'Lainnya').operations.push(operationOf(spec, method, path, operation));
    }
  }
  const filled = [...groups.values()].filter((group) => group.operations.length > 0);
  const servers = Array.isArray(spec.servers) ? spec.servers.filter(isRecord) : [];
  const components = isRecord(spec.components) ? spec.components : {};
  const schemes = isRecord(components.securitySchemes) ? Object.values(components.securitySchemes).filter(isRecord) : [];
  const bearer = schemes.find((scheme) => scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer');
  const errorSchema = isRecord(components.schemas) ? components.schemas.Error : undefined;
  const server = asString(servers[0]?.url);
  const description = asString(info.description);
  return {
    title: asString(info.title) ?? 'API',
    ...(description ? { description } : {}),
    ...(server ? { server } : {}),
    ...(bearer ? { bearer: asString(bearer.description) ? { description: bearer.description as string } : {} } : {}),
    groups: filled,
    pagination: paginationOf(filled),
    errorExample: errorExampleOf(spec, errorSchema, filled),
    rateLimit: rateLimitOf(info, filled),
  };
}

/** The API's absolute base URL: the document's server, made absolute against the site, or `<origin>/api/v1`. */
export function baseUrlOf(docs: Pick<ApiDocs, 'server'>, origin: string, fallbackPath = '/api/v1'): string {
  const target = docs.server ?? fallbackPath;
  try {
    return new URL(target, `${origin}/`).href.replace(/\/$/, '');
  } catch {
    return `${origin}${fallbackPath}`;
  }
}

/** The shell variable a path parameter becomes: `{id}` after `/projects` is `$PROJECT_ID`. */
function variableFor(path: string, name: string): string {
  const segments = path.split('/');
  const index = segments.indexOf(`{${name}}`);
  const before = index > 0 ? segments[index - 1] : '';
  const base = name === 'id' && before && !before.startsWith('{') ? `${before.replace(/s$/, '')}_id` : name;
  return `$${base.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

/** A curl command for the operation, with the token in `$MACROMA_TOKEN` and path parameters as shell variables. */
export function curlFor(operation: DocOperation, baseUrl: string): string {
  const path = operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => variableFor(operation.path, name));
  const query = operation.params
    .filter((param) => param.in === 'query' && param.required)
    .map((param) => `${encodeURIComponent(param.name)}=<${param.name}>`)
    .join('&');
  const url = `${baseUrl}${path}${query ? `?${query}` : ''}`;
  const lines = [
    `curl -s${operation.method === 'GET' ? '' : ` -X ${operation.method}`} "${url}"`,
    `  -H "Authorization: Bearer $MACROMA_TOKEN"`,
  ];
  if (operation.bodyExample !== undefined) {
    const body = JSON.stringify(operation.bodyExample).replace(/'/g, `'\\''`);
    lines.push(`  -H "Content-Type: application/json"`, `  -d '${body}'`);
  }
  return lines.join(' \\\n');
}

/** Splits `code` spans out of a description, so the page can set them in mono without HTML. */
export function inlineParts(text: string): Array<{ code: boolean; text: string }> {
  return text
    .split('`')
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((part) => part.text !== '');
}
