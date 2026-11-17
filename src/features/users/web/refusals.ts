import type { UserProfileError } from '../contract';

/*
 * What the profile and user admin screens say when Users refuses. The API's
 * messages are English, so the UI branches on `code` and shows its own
 * Indonesian text; a code it does not know gets the generic line.
 */

export type UsersRefusal = UserProfileError['code'];

export const USERS_GENERIC_REFUSAL_TEXT = 'Permintaan belum bisa diproses. Coba lagi.';

export const USERS_REFUSAL_TEXT: Record<UsersRefusal, string> = {
  UNAUTHORIZED: 'Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.',
  FORBIDDEN: 'Kamu nggak punya akses untuk ini.',
  VALIDATION_ERROR: 'Ada isian yang belum pas. Cek lagi ya.',
  CSRF_INVALID: 'Sesi halaman ini kedaluwarsa. Muat ulang halaman lalu coba lagi.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  PAYLOAD_TOO_LARGE: 'Filenya terlalu besar.',
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum lanjut.',
  APPLICATION_ERROR: USERS_GENERIC_REFUSAL_TEXT,
  INTERNAL_ERROR: 'Server lagi bermasalah. Coba lagi sebentar lagi.',
  CURRENT_PASSWORD_REQUIRED: 'Untuk akunmu sendiri, ganti password lewat halaman Profil.',
  DUPLICATE_EMAIL: 'Email ini sudah dipakai akun lain.',
  FILE_REQUIRED: 'Pilih foto dulu.',
  FILE_TOO_LARGE: 'Foto maksimal 5 MB.',
  INVALID_FILE_TYPE: 'Foto harus JPG, PNG, GIF, atau WebP.',
  INVALID_ID: 'Data yang diminta nggak valid.',
  INVALID_OUTPUT: 'Foto ini belum bisa diproses. Coba foto lain.',
  LAST_ADMIN: 'Harus ada minimal satu admin.',
  NOT_FOUND: 'Akun ini sudah tidak ada.',
  PROTECTED_ADMIN: 'Akun admin ini nggak bisa diubah dari sini.',
  SELF_DELETE: 'Kamu nggak bisa menghapus akunmu sendiri.',
  SELF_DEMOTION: 'Kamu nggak bisa melepas role admin dari akunmu sendiri.',
  STALE_REVISION: 'Data ini baru diubah orang lain. Cek lagi lalu simpan.',
  UPLOAD_FAILED: 'Foto belum berhasil diunggah. Coba lagi.',
};

/** The text for a refusal, by code; the generic line for a code this map does not know. */
export function usersRefusalText(code: string): string {
  return (USERS_REFUSAL_TEXT as Partial<Record<string, string>>)[code] ?? USERS_GENERIC_REFUSAL_TEXT;
}

/** What a field says when `422 VALIDATION_ERROR` names it, by the field's name in the request body. */
const FIELD_TEXT: Partial<Record<string, string>> = {
  name: 'Nama wajib diisi, maksimal 255 karakter.',
  email: 'Masukkan email yang valid.',
  phone: 'Nomor HP hanya boleh angka, spasi, tanda hubung, dan + di depan.',
  password: 'Password 8–100 karakter.',
  roles: 'Role yang dipilih nggak valid.',
  file: 'Foto harus JPG, PNG, GIF, atau WebP, maksimal 5 MB.',
};

/** Indonesian text per field the API refused; fields it did not name are absent. */
export function usersFieldTexts(errors: Partial<Record<string, string[]>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors ?? {})) {
    if (messages?.length) result[field] = FIELD_TEXT[field] ?? USERS_GENERIC_REFUSAL_TEXT;
  }
  return result;
}
