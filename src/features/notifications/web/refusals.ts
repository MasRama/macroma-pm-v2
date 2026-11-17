import type { NotificationsError } from '../contract';

/*
 * What the bell says when Notifications refuses. The API's messages are
 * English, so the UI branches on `code` and shows its own Indonesian text; a
 * code it does not know gets the generic line.
 */

export type NotificationsRefusal = NotificationsError['code'];

export const NOTIFICATIONS_GENERIC_REFUSAL_TEXT = 'Notifikasi belum bisa diproses. Coba lagi.';

export const NOTIFICATIONS_REFUSAL_TEXT: Record<NotificationsRefusal, string> = {
  UNAUTHORIZED: 'Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.',
  FORBIDDEN: 'Notifikasi ini untuk akun lain.',
  VALIDATION_ERROR: NOTIFICATIONS_GENERIC_REFUSAL_TEXT,
  CSRF_INVALID: 'Sesi halaman ini kedaluwarsa. Muat ulang halaman lalu coba lagi.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  PAYLOAD_TOO_LARGE: NOTIFICATIONS_GENERIC_REFUSAL_TEXT,
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum lanjut.',
  APPLICATION_ERROR: NOTIFICATIONS_GENERIC_REFUSAL_TEXT,
  INTERNAL_ERROR: 'Server lagi bermasalah. Coba lagi sebentar lagi.',
  NOTIFICATION_NOT_FOUND: 'Notifikasi ini sudah tidak ada.',
};

/** The text for a refusal, by code; the generic line for a code this map does not know. */
export function notificationsRefusalText(code: string): string {
  return (NOTIFICATIONS_REFUSAL_TEXT as Partial<Record<string, string>>)[code] ?? NOTIFICATIONS_GENERIC_REFUSAL_TEXT;
}
