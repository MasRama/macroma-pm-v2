export const featureName = 'v1-import' as const;
export type FeatureName = typeof featureName;

/**
 * The knex migrations a Macroma V1 database carries, in order. An import
 * reads only a database with exactly these, so its tables are the ones the
 * mapping knows.
 */
export const V1_MIGRATIONS = [
  '20230513055909_users.ts',
  '20230514062913_sessions.ts',
  '20240101000001_create_password_reset_tokens.ts',
  '20250110233301_assets.ts',
  '20260214120000_create_roles.ts',
  '20260214120001_create_permissions.ts',
  '20260214120002_create_role_permissions.ts',
  '20260214120003_create_user_roles.ts',
  '20260419000001_create_projects_table.ts',
  '20260419000002_create_project_members_table.ts',
  '20260419000003_create_project_batches_table.ts',
  '20260419000004_create_tasks_table.ts',
  '20260419000005_create_task_logs_table.ts',
  '20260419000006_create_project_activity_logs_table.ts',
  '20260419000007_create_project_version_counters_table.ts',
  '20260420000001_add_major_minor_to_project_version_counters.ts',
  '20260422000001_create_workspaces_table.ts',
  '20260422000002_create_workspace_members_table.ts',
  '20260422000003_create_workspace_invitations_table.ts',
  '20260422000004_create_notifications_table.ts',
  '20260422000005_add_workspace_id_to_projects.ts',
  '20260424000001_create_workspace_messages_table.ts',
  '20260425000001_create_task_comments_table.ts',
  '20260804000001_create_task_attachments_table.ts',
] as const;

/** V1 tables that are not carried over: sign-ins and reset links start fresh. */
export const V1_SKIPPED_TABLES = ['sessions', 'password_reset_tokens', 'knex_migrations', 'knex_migrations_lock'] as const;

export interface V1ImportOptions {
  /** The V1 SQLite file; its `-wal` and `-shm` files are read with it. */
  from: string;
  /** V1's `storage/` directory, holding `avatars/` and `task-attachments/`. Without it no file is imported. */
  storageDir?: string;
  /** Run every write, then roll it back; no file is stored. */
  dryRun?: boolean;
}

export interface V1ImportReport {
  dryRun: boolean;
  /** Rows written per V2 table, plus `files` stored. */
  counts: Record<string, number>;
  /** Rows of skipped tables, which are never imported. */
  skipped: Record<string, number>;
  /** Everything imported differently from V1, or left out. */
  warnings: string[];
}

/** The import did not start; `reasons` lists every problem found. */
export class V1ImportRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`V1 import refused:\n  - ${reasons.join('\n  - ')}`);
    this.name = 'V1ImportRefused';
  }
}
