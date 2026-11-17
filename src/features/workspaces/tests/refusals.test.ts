import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES } from '../../../shared/security/codes';
import { WORKSPACES_REFUSAL_CODES } from '../contract';
import {
  WORKSPACES_GENERIC_REFUSAL_TEXT,
  WORKSPACES_REFUSAL_TEXT,
  workspacesFieldTexts,
  workspacesRefusalText,
} from '../web/refusals';

describe('workspaces refusal texts', () => {
  it('has its own text for every code a workspaces route can send', () => {
    for (const code of [...API_REFUSAL_CODES, ...WORKSPACES_REFUSAL_CODES]) {
      expect(WORKSPACES_REFUSAL_TEXT[code], code).toBeTruthy();
      expect(workspacesRefusalText(code)).toBe(WORKSPACES_REFUSAL_TEXT[code]);
    }
  });

  it('falls back to the generic line for a code it does not know', () => {
    expect(workspacesRefusalText('SOMETHING_NEW')).toBe(WORKSPACES_GENERIC_REFUSAL_TEXT);
  });

  it('words each refused field in Indonesian and leaves out fields the API did not name', () => {
    expect(workspacesFieldTexts({ name: ['Name is required'], email: ['Invalid email format'] })).toEqual({
      name: 'Nama wajib diisi, maksimal 255 karakter.',
      email: 'Masukkan email yang valid.',
    });
    expect(workspacesFieldTexts({ color: ['Expected string'] })).toEqual({ color: WORKSPACES_GENERIC_REFUSAL_TEXT });
    expect(workspacesFieldTexts(undefined)).toEqual({});
  });
});
