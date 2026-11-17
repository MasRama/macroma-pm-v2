import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';
import type { UserAsset } from '../contract';

export function createUserAsset(data: {
  id?: string;
  name: string;
  type: string;
  url: string;
  mimeType: string;
  size: number;
  storageKey: string;
  userId: string;
}): UserAsset {
  const id = data.id ?? randomUUID();
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO assets (id, name, type, url, mime_type, size, storage_key, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, data.name, data.type, data.url, data.mimeType, data.size, data.storageKey, data.userId, now, now);
  return getDatabase().prepare('SELECT * FROM assets WHERE id = ?').get(id) as UserAsset;
}

export function findUserAssets(userId: string): UserAsset[] {
  return getDatabase()
    .prepare('SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as UserAsset[];
}

/** Every account that still owns at least one asset. */
export function findAssetOwnerIds(): string[] {
  return (getDatabase().prepare('SELECT DISTINCT user_id FROM assets WHERE user_id IS NOT NULL').all() as Array<{ user_id: string }>).map(
    (row) => row.user_id,
  );
}

/** Assets whose owner was cleared when Auth's account rows still cascaded into this table. */
export function findOwnerlessAssets(): UserAsset[] {
  return getDatabase().prepare('SELECT * FROM assets WHERE user_id IS NULL').all() as UserAsset[];
}

export function findUserAssetByUrl(url: string): UserAsset | undefined {
  return getDatabase().prepare('SELECT * FROM assets WHERE url = ?').get(url) as UserAsset | undefined;
}

export function deleteUserAsset(assetId: string): boolean {
  return getDatabase().prepare('DELETE FROM assets WHERE id = ?').run(assetId).changes > 0;
}

/** Where an avatar image named `filename` (a `<uuid>.webp`) is stored and served from. */
export function avatarLocation(filename: string): { storageKey: string; url: string } {
  return { storageKey: `avatars/${filename}`, url: `/api/assets/avatar/${filename}` };
}

/** An avatar image carried over from another installation; its file is stored at `avatarLocation(filename).storageKey`. */
export interface ImportedAvatarAsset {
  id: string;
  userId: string;
  filename: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

/** Records imported avatar images, inside the caller's transaction. */
export function importAvatarAssets(assets: readonly ImportedAvatarAsset[]): void {
  const database = getDatabase();
  const insert = database.prepare(
    `INSERT INTO assets (id, name, type, url, mime_type, size, storage_key, user_id, created_at, updated_at)
     VALUES (?, ?, 'image', ?, 'image/webp', ?, ?, ?, ?, ?)`,
  );
  database.transaction(() => {
    for (const asset of assets) {
      const { storageKey, url } = avatarLocation(asset.filename);
      insert.run(asset.id, asset.filename, url, asset.size, storageKey, asset.userId, asset.createdAt, asset.updatedAt);
    }
  })();
}
