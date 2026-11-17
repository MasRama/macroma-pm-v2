import { describe, expect, it } from 'vitest';
import { TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES, TASK_ATTACHMENT_MAX_FILES } from '../contract';
import { checkImages, uploadProblems } from '../web/images';

const image = (name: string, size = 10, type = 'image/png') => new File([new Uint8Array(size)], name, { type });

describe('task images picked in the browser', () => {
  it('keeps images the upload route takes and names each other file in Indonesian', () => {
    const png = image('layar.png');
    const webp = image('foto.webp', 10, 'image/webp');
    const { accepted, rejected } = checkImages([
      png,
      image('catatan.txt', 10, 'text/plain'),
      image('besar.jpg', TASK_ATTACHMENT_MAX_FILE_SIZE_BYTES + 1, 'image/jpeg'),
      webp,
    ]);
    expect(accepted).toEqual([png, webp]);
    expect(rejected).toEqual(['catatan.txt: harus JPEG, PNG, GIF, atau WebP.', 'besar.jpg: maksimal 5 MB.']);
  });

  it('takes at most one upload worth of images at a time', () => {
    const files = Array.from({ length: TASK_ATTACHMENT_MAX_FILES + 1 }, (_, index) => image(`layar-${index}.png`));
    const { accepted, rejected } = checkImages(files);
    expect(accepted).toHaveLength(TASK_ATTACHMENT_MAX_FILES);
    expect(rejected).toEqual([`layar-${TASK_ATTACHMENT_MAX_FILES}.png: maksimal ${TASK_ATTACHMENT_MAX_FILES} gambar sekali unggah.`]);
  });

  it('says what did not upload, by name here and by count from the server', () => {
    expect(uploadProblems([], 0)).toBe('');
    expect(uploadProblems(['catatan.txt: harus JPEG, PNG, GIF, atau WebP.'], 2)).toBe(
      'catatan.txt: harus JPEG, PNG, GIF, atau WebP. 2 gambar belum bisa diproses server. Coba file lain.',
    );
  });
});
