import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES } from '../../../shared/security/codes';
import { PROJECTS_REFUSAL_CODES } from '../contract';
import { fieldText, GENERIC_REFUSAL_TEXT, PROJECTS_REFUSAL_TEXT, refusalText } from '../web/refusals';

describe('projects refusal texts', () => {
  it('has its own text for every code a projects route can send', () => {
    for (const code of [...API_REFUSAL_CODES, ...PROJECTS_REFUSAL_CODES]) {
      expect(PROJECTS_REFUSAL_TEXT[code], code).toBeTruthy();
      expect(refusalText(code)).toBe(PROJECTS_REFUSAL_TEXT[code]);
    }
  });

  it('falls back to the generic line for a code it does not know', () => {
    expect(refusalText('SOMETHING_NEW')).toBe(GENERIC_REFUSAL_TEXT);
  });

  it('names a refused field in Indonesian, and nothing for a field the API did not name', () => {
    expect(fieldText({ name: ['Name must be at most 255 characters'] }, 'name')).toBe('Nama wajib diisi, maksimal 255 karakter.');
    expect(fieldText({ name: ['Name is required'] }, 'title')).toBeUndefined();
    expect(fieldText(undefined, 'name')).toBeUndefined();
    expect(fieldText({ sort_order: ['Expected number'] }, 'sort_order')).toBe(GENERIC_REFUSAL_TEXT);
  });
});
