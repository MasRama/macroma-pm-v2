-- Whether the account knows its own password. Google sign-in gives a new (or
-- claimed) account a random password nobody knows; setting a password (a
-- change, a reset by email or by an administrator) makes it usable. Accounts
-- made through Google before this column existed cannot be told apart and
-- count as usable: they set a password by email to confirm with it.
ALTER TABLE users ADD COLUMN password_usable INTEGER NOT NULL DEFAULT 1;
