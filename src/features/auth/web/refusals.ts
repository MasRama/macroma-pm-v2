import type { AuthError } from '../contract';

/*
 * What the sign-in, registration and password screens say when Auth refuses.
 * The API's messages are English, so the UI branches on `code` and shows its
 * own Indonesian text; a code it does not know gets the generic line.
 */

export type AuthRefusal = AuthError['code'];

export const AUTH_GENERIC_REFUSAL_TEXT = 'Permintaan belum bisa diproses. Coba lagi.';

export const AUTH_REFUSAL_TEXT: Record<AuthRefusal, string> = {
  UNAUTHORIZED: 'Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.',
  FORBIDDEN: 'Kamu nggak punya akses untuk ini.',
  VALIDATION_ERROR: 'Ada isian yang belum pas. Cek lagi ya.',
  CSRF_INVALID: 'Sesi halaman ini kedaluwarsa. Muat ulang halaman lalu coba lagi.',
  RATE_LIMITED: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
  PAYLOAD_TOO_LARGE: 'Isiannya terlalu besar.',
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum lanjut.',
  APPLICATION_ERROR: AUTH_GENERIC_REFUSAL_TEXT,
  INTERNAL_ERROR: 'Server lagi bermasalah. Coba lagi sebentar lagi.',
  CURRENT_SESSION: 'Sesi yang sedang kamu pakai nggak bisa dikeluarkan dari sini.',
  DUPLICATE_EMAIL: 'Email ini sudah dipakai akun lain.',
  DUPLICATE_SLUG: 'Slug role ini sudah dipakai.',
  GOOGLE_DISABLED: 'Masuk dengan Google belum aktif di server ini.',
  INVALID_CREDENTIALS: 'Email atau password salah.',
  INVALID_ID: 'Data yang diminta nggak valid.',
  INVALID_PASSWORD: 'Password saat ini salah.',
  INVALID_TWO_FACTOR_CODE: 'Kodenya salah. Coba lagi.',
  LOGIN_LOCKED: 'Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.',
  MAIL_DISABLED: 'Reset password lewat email belum aktif di server ini. Minta admin untuk reset password kamu.',
  NOT_FOUND: 'Datanya sudah tidak ada.',
  PROTECTED_ROLE: 'Role ini nggak bisa diubah atau dihapus.',
  RESET_TOKEN_INVALID: 'Link reset ini sudah tidak berlaku. Minta link baru.',
  STALE_REVISION: 'Data ini baru diubah orang lain. Cek lagi lalu simpan.',
  TOKEN_LIMIT_REACHED: 'Token API kamu sudah mencapai batas. Cabut salah satu dulu.',
  TWO_FACTOR_CHALLENGE_EXPIRED: 'Waktu memasukkan kode sudah habis. Masuk lagi dari awal.',
  TWO_FACTOR_DISABLED: 'Verifikasi dua langkah belum aktif.',
  TWO_FACTOR_ENABLED: 'Verifikasi dua langkah sudah aktif.',
  TWO_FACTOR_LOCKED: 'Terlalu banyak kode salah. Masuk lagi dari awal.',
  TWO_FACTOR_SETUP_REQUIRED: 'Siapkan verifikasi dua langkah dulu.',
};

/** The text for a refusal, by code; the generic line for a code this map does not know. */
export function authRefusalText(code: string): string {
  return (AUTH_REFUSAL_TEXT as Partial<Record<string, string>>)[code] ?? AUTH_GENERIC_REFUSAL_TEXT;
}

/** What a field says when `422 VALIDATION_ERROR` names it, by the field's name in the request body. */
const FIELD_TEXT: Partial<Record<string, string>> = {
  name: 'Nama wajib diisi, maksimal 255 karakter.',
  email: 'Masukkan email yang valid.',
  password: 'Password 8–100 karakter.',
  new_password: 'Password baru 8–100 karakter.',
  current_password: 'Password saat ini wajib diisi.',
  phone: 'Nomor HP hanya boleh angka, spasi, tanda hubung, dan + di depan.',
  code: 'Kode 6 digit dari aplikasi authenticator.',
  recovery_code: 'Kode pemulihan belum valid.',
  token: 'Link reset ini sudah tidak berlaku. Minta link baru.',
  scope: 'Pilih akses token: baca saja atau baca dan tulis.',
  expiresInDays: 'Masa berlaku 1–365 hari, atau tanpa batas.',
};

/** Indonesian text per field the API refused; fields it did not name are absent. */
export function authFieldTexts(errors: Partial<Record<string, string[]>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors ?? {})) {
    if (messages?.length) result[field] = FIELD_TEXT[field] ?? AUTH_GENERIC_REFUSAL_TEXT;
  }
  return result;
}
