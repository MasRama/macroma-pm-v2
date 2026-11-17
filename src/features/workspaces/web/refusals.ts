import type { WorkspacesError } from '../contract';

/*
 * What the workspace screens say when Workspaces refuses. The API's messages
 * are English, so the UI branches on `code` and shows its own Indonesian
 * text; a code it does not know gets the generic line.
 */

export type WorkspacesRefusal = WorkspacesError['code'];

export const WORKSPACES_GENERIC_REFUSAL_TEXT = 'Permintaan belum bisa diproses. Coba lagi.';

export const WORKSPACES_REFUSAL_TEXT: Record<WorkspacesRefusal, string> = {
  UNAUTHORIZED: 'Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.',
  FORBIDDEN: 'Akun kamu tidak boleh melakukan ini di workspace ini.',
  VALIDATION_ERROR: 'Ada isian yang belum pas. Cek lagi ya.',
  CSRF_INVALID: 'Sesi halaman ini kedaluwarsa. Muat ulang halaman lalu coba lagi.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
  PAYLOAD_TOO_LARGE: 'Isiannya terlalu besar.',
  PASSWORD_CHANGE_REQUIRED: 'Ganti password dulu sebelum lanjut.',
  APPLICATION_ERROR: WORKSPACES_GENERIC_REFUSAL_TEXT,
  INTERNAL_ERROR: 'Server lagi bermasalah. Coba lagi sebentar lagi.',
  WORKSPACE_NOT_FOUND: 'Workspace ini sudah tidak ada.',
  ACCOUNT_NOT_FOUND: 'Belum ada akun dengan email ini. Minta dia daftar dulu.',
  ALREADY_MEMBER: 'Akun ini sudah jadi anggota workspace.',
  INVITATION_PENDING: 'Email ini masih punya undangan yang belum dijawab.',
  INVITATION_NOT_FOUND: 'Undangan ini sudah tidak berlaku.',
  INVITATION_NOT_PENDING: 'Undangan ini sudah dijawab.',
  INVITATION_EXPIRED: 'Undangan ini sudah kedaluwarsa. Minta undangan baru ke pemilik workspace.',
  MEMBER_NOT_FOUND: 'Akun itu sudah bukan anggota workspace.',
  OWNER_CANNOT_LEAVE: 'Owner tidak bisa keluar atau dikeluarkan dari workspace-nya.',
  STALE_REVISION: 'Workspace ini baru diubah orang lain. Cek lagi lalu simpan.',
};

/** The text for a refusal, by code; the generic line for a code this map does not know. */
export function workspacesRefusalText(code: string): string {
  return (WORKSPACES_REFUSAL_TEXT as Partial<Record<string, string>>)[code] ?? WORKSPACES_GENERIC_REFUSAL_TEXT;
}

/** What a field says when `422 VALIDATION_ERROR` names it, by the field's name in the request body. */
const FIELD_TEXT: Partial<Record<string, string>> = {
  name: 'Nama wajib diisi, maksimal 255 karakter.',
  description: 'Deskripsi maksimal 2000 karakter.',
  email: 'Masukkan email yang valid.',
  message: 'Pesan wajib diisi, maksimal 2000 karakter.',
};

/** Indonesian text per field the API refused; fields it did not name are absent. */
export function workspacesFieldTexts(errors: Partial<Record<string, string[]>> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors ?? {})) {
    if (messages?.length) result[field] = FIELD_TEXT[field] ?? WORKSPACES_GENERIC_REFUSAL_TEXT;
  }
  return result;
}
