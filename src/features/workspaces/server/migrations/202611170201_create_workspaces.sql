-- Accounts live in Auth's users table; this Feature keeps no foreign keys into
-- it and forgets deleted accounts through forgetAccounts instead.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX workspaces_owner_idx ON workspaces (owner_id);

CREATE TABLE workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);

CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL,
  invitee_email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX workspace_invitations_workspace_idx ON workspace_invitations (workspace_id, status);
CREATE INDEX workspace_invitations_invitee_idx ON workspace_invitations (invitee_email, status);

CREATE TABLE workspace_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX workspace_messages_workspace_idx ON workspace_messages (workspace_id, created_at);
