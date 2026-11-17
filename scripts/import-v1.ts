import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { syncDeclaredPermissions, syncDeclaredRoles } from '../src/features/auth';
import { importV1, V1ImportRefused } from '../src/features/v1-import';
import { discoverMigrations, getDatabase, getDatabasePath, outstandingMigrations } from '../src/shared/database';
import { createLocalAssetStorage } from '../src/shared/storage';

const USAGE = `Usage:
  npm run import:v1 -- --from <v1.sqlite3> [--storage <v1 storage dir>] [--dry-run]

Imports a Macroma V1 database into the database DB_FILE names (run npm run migrate
first). Files go to ./storage, where the application serves them from. Like a server
start, it first writes the permissions and roles the application declares (also on a
dry run), so V1 roles keep every permission V2 has.
`;

async function run(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      storage: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.from) {
    process.stderr.write(USAGE);
    process.exitCode = values.help ? 0 : 64;
    return;
  }

  const dryRun = values['dry-run'] ?? false;
  if (outstandingMigrations(getDatabase(), discoverMigrations()).length > 0) {
    throw new Error(`${getDatabasePath()} has pending migrations; run npm run migrate first.`);
  }
  // Composing the application declares the Features' permissions, as the server does at start.
  await import('../src/app/server');
  syncDeclaredPermissions();
  syncDeclaredRoles();

  process.stdout.write(`${dryRun ? 'Dry run: ' : ''}importing ${resolve(values.from)} into ${getDatabasePath()}\n`);
  const report = await importV1(
    { from: resolve(values.from), storageDir: values.storage ? resolve(values.storage) : undefined, dryRun },
    createLocalAssetStorage({ root: resolve(process.cwd(), 'storage') }),
  );

  process.stdout.write(dryRun ? 'Rows the import would write (rolled back, no file stored):\n' : 'Rows written:\n');
  for (const [table, rows] of Object.entries(report.counts)) process.stdout.write(`  ${table}: ${rows}\n`);
  process.stdout.write('Skipped V1 tables:\n');
  for (const [table, rows] of Object.entries(report.skipped)) process.stdout.write(`  ${table}: ${rows}\n`);
  process.stdout.write(report.warnings.length > 0 ? 'Warnings:\n' : 'Warnings: none\n');
  for (const warning of report.warnings) process.stdout.write(`  - ${warning}\n`);
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof V1ImportRefused || error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
