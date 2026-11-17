import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  TASK_ATTACHMENT_ALLOWED_MIME_TYPES,
  TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  TASK_ATTACHMENT_MAX_FILE_SIZE_MB,
  TASK_ATTACHMENT_MAX_FILES,
} from '../contract';
import type { ProjectsServerHost } from './host';

const STORAGE_PREFIX = 'task-attachments';

const IMAGE_MAGIC_BYTES: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
};

/** Whether the bytes start the way the declared image type does; the browser's type alone is not trusted. */
function hasMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const expected = IMAGE_MAGIC_BYTES[mimeType];
  if (!expected || buffer.length < expected.length) return false;
  if (!expected.every((byte, index) => buffer[index] === byte)) return false;
  return mimeType !== 'image/webp' || buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

function isFile(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

/** The uploaded files of a multipart body, in the order they were sent, under any field name. */
export function uploadedFiles(body: Record<string, unknown>): File[] {
  return Object.values(body).flatMap((value) => (Array.isArray(value) ? value : [value])).filter(isFile);
}

/** A display name without path or control characters, at most 255 characters. */
function displayName(file: File, id: string): string {
  const name = (file.name ?? '').split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() ?? '';
  return (name || `${id}.webp`).slice(0, 255);
}

export interface StoredImage {
  id: string;
  storageKey: string;
  name: string;
  size: number;
}

/**
 * Converts and stores each usable image (WebP, quality 82, within 1600×1600),
 * one by one so a batch never holds every decoded image in memory at once.
 * Files past the limit, of another type, too large or unreadable are skipped
 * with a reason; the rest still upload.
 */
export async function storeImages(host: ProjectsServerHost, files: readonly File[]): Promise<{ stored: StoredImage[]; errors: string[] }> {
  const stored: StoredImage[] = [];
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    const id = randomUUID();
    const name = displayName(file, id);
    if (index >= TASK_ATTACHMENT_MAX_FILES) {
      errors.push(`${name}: at most ${TASK_ATTACHMENT_MAX_FILES} files per upload`);
      continue;
    }
    if (!TASK_ATTACHMENT_ALLOWED_MIME_TYPES.some((type) => type === file.type)) {
      errors.push(`${name}: only JPEG, PNG, GIF or WebP images are accepted`);
      continue;
    }
    if (file.size > TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
      errors.push(`${name}: larger than ${TASK_ATTACHMENT_MAX_FILE_SIZE_MB}MB`);
      continue;
    }
    try {
      const source = Buffer.from(await file.arrayBuffer());
      if (!hasMagicBytes(source, file.type)) {
        errors.push(`${name}: not a valid image`);
        continue;
      }
      const image = await sharp(source)
        .webp({ quality: 82 })
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      const storageKey = `${STORAGE_PREFIX}/${id}.webp`;
      await host.assetStorage.put({ key: storageKey, data: image, contentType: 'image/webp' });
      stored.push({ id, storageKey, name, size: image.length });
    } catch {
      errors.push(`${name}: the image could not be processed`);
    }
  }
  return { stored, errors };
}

/** Deletes stored images whose rows are already gone; best-effort, as a missing row already refuses the file. */
export async function removeStoredImages(host: ProjectsServerHost, storageKeys: readonly string[]): Promise<void> {
  await Promise.all(storageKeys.map((key) => host.assetStorage.delete(key).catch(() => false)));
}
