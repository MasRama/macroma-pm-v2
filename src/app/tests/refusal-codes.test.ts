import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES, API_TOKEN_REFUSAL_CODES } from '../../shared/security/codes';

// Every route can be answered by the pipeline ahead of it, so each code that
// pipeline sends must be one every Feature's contract already accepts.
const PIPELINE_SOURCES = [
  ...readdirSync('src/shared/security')
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join('src/shared/security', file)),
  'src/app/error-handler.ts',
  'src/features/auth/server/password-change-gate.ts',
];

// The public API's bearer pipeline runs ahead of every /api/v1 route.
const BEARER_PIPELINE_SOURCES = ['src/features/auth/server/api-tokens.ts'];

function codesSentBy(sources: readonly string[]): Set<string> {
  const sent = new Set<string>();
  for (const source of sources) {
    for (const match of readFileSync(source, 'utf8').matchAll(/code(?::| =) '([A-Z][A-Z0-9_]+)'/g)) sent.add(match[1]);
  }
  return sent;
}

describe('API refusal codes', () => {
  it('declares every code the shared pipeline answers with', () => {
    const sent = codesSentBy(PIPELINE_SOURCES);

    expect(sent.size).toBeGreaterThan(5);
    expect([...sent].filter((code) => !(API_REFUSAL_CODES as readonly string[]).includes(code))).toEqual([]);
  });

  it('declares every code the public API bearer pipeline answers with', () => {
    const sent = codesSentBy(BEARER_PIPELINE_SOURCES);
    const declared: readonly string[] = [...API_REFUSAL_CODES, ...API_TOKEN_REFUSAL_CODES];

    expect([...sent].sort()).toEqual([...API_TOKEN_REFUSAL_CODES, 'PASSWORD_CHANGE_REQUIRED'].sort());
    expect([...sent].filter((code) => !declared.includes(code))).toEqual([]);
  });
});
