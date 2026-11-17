-- A contact phone number (never a sign-in identifier) and whether an
-- administrator, or Google, vouched for the account.
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_verified ON users (verified);
