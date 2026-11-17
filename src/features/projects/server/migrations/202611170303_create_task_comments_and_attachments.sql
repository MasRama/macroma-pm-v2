-- Authors and uploaders are accounts of Auth's users table, kept without a
-- foreign key: forgetAccounts clears them, as V1's ON DELETE SET NULL did.
CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);
CREATE INDEX task_comments_user_idx ON task_comments (user_id);

-- The image itself lives in asset storage under storage_key; rows are deleted
-- before their stored object, so a missing row always refuses the file.
CREATE TABLE task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX task_attachments_task_idx ON task_attachments (task_id, created_at);
CREATE INDEX task_attachments_uploader_idx ON task_attachments (uploaded_by);
