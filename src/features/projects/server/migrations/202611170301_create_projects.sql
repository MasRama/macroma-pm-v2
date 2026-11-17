-- Accounts live in Auth's users table and workspaces in the Workspaces
-- Feature; this Feature keeps no foreign keys into either. Deleted accounts
-- are forgotten through forgetAccounts, deleted workspaces through
-- detachWorkspace.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  workspace_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX projects_owner_idx ON projects (owner_id);
CREATE INDEX projects_workspace_idx ON projects (workspace_id);

CREATE TABLE project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, user_id)
);

CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE project_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  major INTEGER NOT NULL DEFAULT 0,
  minor INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX project_batches_project_idx ON project_batches (project_id, major, minor);
-- A project has at most one active batch.
CREATE UNIQUE INDEX project_batches_active_idx ON project_batches (project_id) WHERE is_active = 1;

-- The project's current version: batches move major/minor, every task change moves the patch.
CREATE TABLE project_version_counters (
  project_id TEXT PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  patch_counter INTEGER NOT NULL DEFAULT 0,
  major INTEGER NOT NULL DEFAULT 0,
  minor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  batch_id TEXT REFERENCES project_batches (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assignee_id TEXT,
  column_id TEXT NOT NULL DEFAULT 'backlog' CHECK (column_id IN ('backlog', 'ongoing', 'revisi', 'review', 'done')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  version_major INTEGER NOT NULL DEFAULT 0,
  version_minor INTEGER NOT NULL DEFAULT 1,
  version_patch INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX tasks_project_column_idx ON tasks (project_id, column_id, sort_order);
CREATE INDEX tasks_batch_column_idx ON tasks (batch_id, column_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);

-- Append-only: one row per version a task went through.
CREATE TABLE task_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  column_from TEXT,
  column_to TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- Serves both a task's history and its derived revisi count.
CREATE INDEX task_logs_task_column_idx ON task_logs (task_id, column_to);
CREATE INDEX task_logs_created_by_idx ON task_logs (created_by);

CREATE TABLE project_activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_id TEXT,
  task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  batch_id TEXT REFERENCES project_batches (id) ON DELETE SET NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX project_activity_logs_project_idx ON project_activity_logs (project_id, created_at DESC);
CREATE INDEX project_activity_logs_actor_idx ON project_activity_logs (actor_id);
