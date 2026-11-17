import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { V1_MIGRATIONS } from '../contract';

export interface V1Source {
  database: Database.Database;
  /** Closes the copy and removes it. */
  close(): void;
}

/**
 * Opens a read-only copy of the V1 database. The file and its `-wal`/`-shm`
 * companions are copied together, because V1 can hold committed rows only in
 * its WAL; the original files are never opened.
 */
export function openV1Copy(from: string): V1Source {
  const directory = mkdtempSync(path.join(tmpdir(), 'macroma-v1-'));
  try {
    const copy = path.join(directory, 'v1.sqlite3');
    copyFileSync(from, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${from}${suffix}`)) copyFileSync(`${from}${suffix}`, `${copy}${suffix}`);
    }
    const database = new Database(copy, { readonly: true, fileMustExist: true });
    return {
      database,
      close: () => {
        database.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Why the database is not a V1 database this import knows, if it is not. */
export function v1SchemaProblems(database: Database.Database): string[] {
  const ledger = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'knex_migrations'").get();
  if (!ledger) return ['the source has no knex_migrations table, so it is not a Macroma V1 database'];
  const applied = new Set((database.prepare('SELECT name FROM knex_migrations').all() as Array<{ name: string }>).map((row) => row.name));
  const expected = new Set<string>(V1_MIGRATIONS);
  const missing = V1_MIGRATIONS.filter((name) => !applied.has(name));
  const unknown = [...applied].filter((name) => !expected.has(name)).sort();
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`the source lacks V1 migrations: ${missing.join(', ')}`);
  if (unknown.length > 0) problems.push(`the source has migrations this import does not know: ${unknown.join(', ')}`);
  return problems;
}
