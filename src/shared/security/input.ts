import { z } from 'zod';

// Shared validation stays feature-neutral. Business-specific schemas live in
// their Feature contracts; passwords are never trimmed or transformed.
export function hasNoControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

export const CONTROL_MESSAGE = 'must not contain control characters';

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100)
  .refine(hasNoControlChars, { message: `Name ${CONTROL_MESSAGE}` });

export const emailSchema = z
  .string()
  .trim()
  .email('Invalid email format')
  .refine(hasNoControlChars, { message: `Email ${CONTROL_MESSAGE}` })
  .transform((value) => value.toLowerCase());

/**
 * An optional contact phone number: digits with the usual separators and an
 * optional leading `+`. Empty means no number, stored as null.
 */
export const phoneSchema = z
  .string()
  .trim()
  .max(30, 'Phone must be at most 30 characters')
  .regex(/^(\+?[0-9][0-9 ().-]*)?$/, 'Phone may only contain digits, spaces, dashes, dots, brackets and a leading +')
  .transform((value) => (value === '' ? null : value))
  .nullable();
