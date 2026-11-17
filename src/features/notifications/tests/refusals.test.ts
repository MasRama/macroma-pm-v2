import { describe, expect, it } from 'vitest';
import { API_REFUSAL_CODES } from '../../../shared/security/codes';
import { NOTIFICATIONS_REFUSAL_CODES } from '../contract';
import { NOTIFICATIONS_GENERIC_REFUSAL_TEXT, NOTIFICATIONS_REFUSAL_TEXT, notificationsRefusalText } from '../web/refusals';

describe('notifications refusal texts', () => {
  it('has a text for every code a notifications route can send', () => {
    for (const code of [...API_REFUSAL_CODES, ...NOTIFICATIONS_REFUSAL_CODES]) {
      expect(NOTIFICATIONS_REFUSAL_TEXT[code], code).toBeTruthy();
      expect(notificationsRefusalText(code)).toBe(NOTIFICATIONS_REFUSAL_TEXT[code]);
    }
  });

  it('falls back to the generic line for a code it does not know', () => {
    expect(notificationsRefusalText('SOMETHING_NEW')).toBe(NOTIFICATIONS_GENERIC_REFUSAL_TEXT);
  });
});
