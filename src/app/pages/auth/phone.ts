/**
 * The phone rule Auth and Users validate with (digits, spaces, dashes, dots,
 * brackets and a leading +, at most 30 characters), checked before sending so
 * the form can answer in its own words. Empty means no phone.
 */
export function isPhone(value: string): boolean {
  const phone = value.trim();
  return phone.length <= 30 && /^(\+?[0-9][0-9 ().-]*)?$/.test(phone);
}
