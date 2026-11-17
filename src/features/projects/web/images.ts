import {
  TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  TASK_ATTACHMENT_MAX_FILE_SIZE_MB,
  TASK_ATTACHMENT_MAX_FILES,
} from '../contract';

export interface CheckedImages {
  /** Files the upload route takes: allowed type and size, at most one upload's worth. */
  accepted: File[];
  /** Why each other file was left out, in Indonesian. */
  rejected: string[];
}

/**
 * Sorts picked files before they are sent, by the upload route's own limits,
 * so the person learns at once which file is wrong. The server still checks
 * every file.
 */
export function checkImages(files: readonly File[]): CheckedImages {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (!(TASK_ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      rejected.push(`${file.name}: harus JPEG, PNG, GIF, atau WebP.`);
    } else if (file.size > TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      rejected.push(`${file.name}: maksimal ${TASK_ATTACHMENT_MAX_FILE_SIZE_MB} MB.`);
    } else if (accepted.length >= TASK_ATTACHMENT_MAX_FILES) {
      rejected.push(`${file.name}: maksimal ${TASK_ATTACHMENT_MAX_FILES} gambar sekali unggah.`);
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** What to say when some files did not upload: the ones checked here by name, the ones the server refused by count. */
export function uploadProblems(rejected: readonly string[], refusedByServer: number): string {
  const lines = [...rejected];
  if (refusedByServer > 0) lines.push(`${refusedByServer} gambar belum bisa diproses server. Coba file lain.`);
  return lines.join(' ');
}
