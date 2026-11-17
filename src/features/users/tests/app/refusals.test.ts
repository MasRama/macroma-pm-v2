import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES } from '../../../../shared/security/codes';
import { USERS_REFUSAL_CODES } from '../../contract';
import { USERS_GENERIC_REFUSAL_TEXT, USERS_REFUSAL_TEXT, usersFieldTexts, usersRefusalText } from '../../web';

describe('users refusal texts', () => {
  it('has its own text for every code a users route can send', () => {
    for (const code of [...API_REFUSAL_CODES, ...USERS_REFUSAL_CODES]) {
      expect(USERS_REFUSAL_TEXT[code], code).toBeTruthy();
      expect(usersRefusalText(code)).toBe(USERS_REFUSAL_TEXT[code]);
    }
  });

  it('falls back to the generic line for a code it does not know', () => {
    expect(usersRefusalText('SOMETHING_NEW')).toBe(USERS_GENERIC_REFUSAL_TEXT);
  });

  it('words each refused field in Indonesian and leaves out fields the API did not name', () => {
    expect(usersFieldTexts({ email: ['Invalid email format'], phone: ['Invalid phone'] })).toEqual({
      email: 'Masukkan email yang valid.',
      phone: 'Nomor HP hanya boleh angka, spasi, tanda hubung, dan + di depan.',
    });
    expect(usersFieldTexts({ verified: ['Expected boolean'] })).toEqual({ verified: USERS_GENERIC_REFUSAL_TEXT });
    expect(usersFieldTexts(undefined)).toEqual({});
  });
});
