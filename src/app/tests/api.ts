import { csrfHeaders, issueCsrf } from '../../shared/security/tests/helpers';
import { app } from '../server';
import type { Persona } from './personas';

export interface ApiAnswer<T = any> {
  status: number;
  body: T;
}

/** Calls the composed application as the persona, with a CSRF token on writes, and reads the JSON answer. */
export async function callApi<T = any>(persona: Persona | undefined, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  let requestHeaders: Record<string, string>;
  if (method === 'GET' || method === 'HEAD') {
    requestHeaders = persona ? { ...headers, Cookie: persona.cookie } : headers;
  } else {
    requestHeaders = csrfHeaders(await issueCsrf(app, persona?.cookie), headers);
  }
  const response = await app.request(path, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}
