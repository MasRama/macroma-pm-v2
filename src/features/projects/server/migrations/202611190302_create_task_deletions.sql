-- A row per deleted task, so a public API client that syncs with
-- `updated_since` also learns which tasks are gone. Rows stay; deleting the
-- project takes its rows with it.
CREATE TABLE task_deletions (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  deleted_at INTEGER NOT NULL
);

CREATE INDEX task_deletions_project_idx ON task_deletions (project_id, deleted_at, task_id);
