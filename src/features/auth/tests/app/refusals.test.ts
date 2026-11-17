import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES } from '../../../../shared/security/codes';
import { AUTH_REFUSAL_CODES } from '../../contract';
import { AUTH_GENERIC_REFUSAL_TEXT, AUTH_REFUSAL_TEXT, authFieldTexts, authRefusalText } from '../../web';

describe('auth refusal texts', () => {
  it('has its own text for every code an auth route can send', () => {
    for (const code of [...API_REFUSAL_CODES, ...AUTH_REFUSAL_CODES]) {
      expect(AUTH_REFUSAL_TEXT[code], code).toBeTruthy();
      expect(authRefusalText(code)).toBe(AUTH_REFUSAL_TEXT[code]);
    }
  });

  it('falls back to the generic line for a code it does not know', () => {
    expect(authRefusalText('SOMETHING_NEW')).toBe(AUTH_GENERIC_REFUSAL_TEXT);
  });

  it('words each refused field in Indonesian and leaves out fields the API did not name', () => {
    expect(authFieldTexts({ email: ['Invalid email format'], new_password: ['Too short'] })).toEqual({
      email: 'Masukkan email yang valid.',
      new_password: 'Password baru 8–100 karakter.',
    });
    expect(authFieldTexts({ remember: ['Expected boolean'] })).toEqual({ remember: AUTH_GENERIC_REFUSAL_TEXT });
    expect(authFieldTexts(undefined)).toEqual({});
  });
});
