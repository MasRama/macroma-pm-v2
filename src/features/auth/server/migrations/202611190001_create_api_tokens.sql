-- Personal access tokens for the public API (/api/v1). Only the SHA-256 of
-- the token is stored, so a copy of the database cannot call the API as
-- anyone; `prefix` is the token's first characters, shown so people can tell
-- their tokens apart. Revoked and expired rows stay a while so the API can
-- say which it was.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_api_tokens_user_id ON api_tokens (user_id);
