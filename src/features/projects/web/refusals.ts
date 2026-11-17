import type { ProjectsError } from '../contract';

/*
 * What the projects screens say when the API refuses. The API's messages are
 * English, so the UI branches on `code` and shows its own text; a code it does
 * not know gets the generic line.
 */

export type ProjectsRefusal = ProjectsError['code'];

export const GENERIC_REFUSAL_TEXT = 'Permintaan belum bisa diproses. Coba lagi.';

export const PROJECTS_REFUSAL_TEXT: Record<ProjectsRefusal, string> = {
  UNAUTHORIZED: 'Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.',
  FORBIDDEN: 'Kamu nggak punya akses ke project ini.',
  VALIDATION_ERROR: 'Ada isian yang belum pas. Cek lagi ya.',
  CSRF_INVALID: 'Sesi halaman ini kedaluwarsa. Muat ulang halaman lalu coba lagi.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  PAYLOAD_TOO_LARGE: 'Isiannya terlalu besar.',
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum lanjut.',
  APPLICATION_ERROR: GENERIC_REFUSAL_TEXT,
  INTERNAL_ERROR: 'Server lagi bermasalah. Coba lagi sebentar lagi.',
  PROJECT_NOT_FOUND: 'Project ini sudah tidak ada.',
  BATCH_NOT_FOUND: 'Batch ini sudah tidak ada.',
  TASK_NOT_FOUND: 'Task ini sudah tidak ada.',
  ACCOUNT_NOT_FOUND: 'Belum ada akun dengan email itu.',
  ALREADY_MEMBER: 'Akun itu sudah jadi anggota project ini.',
  MEMBER_NOT_FOUND: 'Akun itu bukan anggota project ini.',
  OWNER_CANNOT_BE_REMOVED: 'Owner project nggak bisa dikeluarkan.',
  TASK_ALREADY_IN_COLUMN: 'Task ini sudah ada di kolom itu.',
  COMMENT_NOT_FOUND: 'Komentar ini sudah tidak ada.',
  ATTACHMENT_NOT_FOUND: 'Gambar ini sudah tidak ada.',
  NO_FILES_PROCESSED: 'Nggak ada gambar yang berhasil diunggah.',
  STALE_REVISION: 'Data ini baru diubah orang lain. Cek lagi lalu simpan.',
};

/** The text for a refusal, by code; the generic line for a code this map does not know. */
export function refusalText(code: string): string {
  return (PROJECTS_REFUSAL_TEXT as Partial<Record<string, string>>)[code] ?? GENERIC_REFUSAL_TEXT;
}

/** What a field says when `422 VALIDATION_ERROR` names it, by the field's name in the request body. */
const FIELD_TEXT: Partial<Record<string, string>> = {
  name: 'Nama wajib diisi, maksimal 255 karakter.',
  title: 'Judul wajib diisi, maksimal 500 karakter.',
  description: 'Deskripsinya terlalu panjang.',
  note: 'Catatan maksimal 2000 karakter.',
  content: 'Komentar wajib diisi, maksimal 2000 karakter.',
  assignee_id: 'Assignee ini nggak bisa membuka project.',
  email: 'Email belum valid.',
  files: 'Gambarnya belum bisa diproses.',
};

/** The Indonesian text for a field the API refused, or `undefined` when it did not name that field. */
export function fieldText(errors: Partial<Record<string, string[]>> | undefined, field: string): string | undefined {
  if (!errors?.[field]?.length) return undefined;
  return FIELD_TEXT[field] ?? GENERIC_REFUSAL_TEXT;
}
