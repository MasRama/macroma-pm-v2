import { randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  password: string;
  avatar: string | null;
  phone: string | null;
  verified: number;
  must_change_password: number;
  /** 0 while the account only has the random password Google sign-in gave it. */
  password_usable: number;
  created_at: number;
  updated_at: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  phone: string | null;
  verified: number;
  must_change_password: number;
  password_usable: number;
}

const STORED_USER_COLUMNS =
  'id, name, email, password, avatar, phone, verified, must_change_password, password_usable, created_at, updated_at';

export function findUserByEmail(email: string): StoredUser | undefined {
  return getDatabase()
    .prepare(`SELECT ${STORED_USER_COLUMNS} FROM users WHERE email = ?`)
    .get(email) as StoredUser | undefined;
}

export function findUserById(userId: string): StoredUser | undefined {
  return getDatabase()
    .prepare(`SELECT ${STORED_USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as StoredUser | undefined;
}

export function createUser(data: {
  id: string;
  name: string;
  email: string;
  password: string;
  phone?: string | null;
  verified?: boolean;
  /** False for the random password Google sign-in gives a new account. */
  passwordUsable?: boolean;
}): StoredUser {
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO users (id, name, email, password, phone, verified, password_usable, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.id,
      data.name,
      data.email,
      data.password,
      data.phone ?? null,
      data.verified ? 1 : 0,
      data.passwordUsable === false ? 0 : 1,
      now,
      now,
    );

  return findUserByEmail(data.email)!;
}

export function updatePassword(userId: string, password: string): void {
  getDatabase()
    .prepare('UPDATE users SET password = ?, must_change_password = 0, password_usable = 1, updated_at = ? WHERE id = ?')
    .run(password, Date.now(), userId);
}

/**
 * Hands an unverified account to whoever just proved they own its email (a
 * verified Google sign-in): anyone could have registered that email first,
 * so the password becomes one nobody knows, and every session, second factor,
 * reset link and API token set up before is dropped. All at once.
 */
export function claimUnverifiedAccount(userId: string, unusablePasswordHash: string): void {
  const database = getDatabase();
  database.transaction(() => {
    const now = Date.now();
    database
      .prepare(
        `UPDATE users
         SET password = ?, verified = 1, must_change_password = 0, password_usable = 0,
             two_factor_secret = NULL, two_factor_pending_secret = NULL, two_factor_enabled_at = NULL,
             two_factor_last_step = NULL, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(unusablePasswordHash, now, userId);
    database.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM two_factor_challenges WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  })();
}

export function deleteSessionsByUserId(userId: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export interface StoredSession {
  id: string;
  handle: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: number;
  last_seen_at: number | null;
}

export function createSession(data: {
  id: string;
  handle: string;
  userId: string;
  userAgent: string | undefined;
  ipAddress: string | undefined;
  expiresAt: number;
  maxPerUser: number;
}): void {
  const database = getDatabase();
  const now = Date.now();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO sessions (id, handle, user_id, user_agent, ip_address, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(data.id, data.handle, data.userId, data.userAgent ?? null, data.ipAddress ?? null, data.expiresAt, now, now);
    // Bound per-account session growth: the oldest devices fall off first.
    database
      .prepare(
        `DELETE FROM sessions
         WHERE user_id = ?
           AND id NOT IN (
             SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`,
      )
      .run(data.userId, data.userId, data.maxPerUser);
  })();
}

export function findUserBySessionId(sessionId: string): (SessionUser & { session_last_seen_at: number | null }) | undefined {
  return getDatabase()
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar, u.phone, u.verified, u.must_change_password, u.password_usable,
              s.last_seen_at AS session_last_seen_at
       FROM users u
       INNER JOIN sessions s ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, Date.now()) as (SessionUser & { session_last_seen_at: number | null }) | undefined;
}

/** When the session signed in, or undefined for an unknown one. */
export function sessionCreatedAt(sessionId: string): number | undefined {
  const row = getDatabase().prepare('SELECT created_at FROM sessions WHERE id = ?').get(sessionId) as
    | { created_at: number }
    | undefined;
  return row?.created_at;
}

export function touchSession(sessionId: string, now: number): void {
  getDatabase().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, sessionId);
}

export function listActiveSessions(userId: string, now: number = Date.now()): StoredSession[] {
  return getDatabase()
    .prepare(
      `SELECT id, handle, user_agent, ip_address, created_at, last_seen_at
       FROM sessions
       WHERE user_id = ? AND expires_at > ?
       ORDER BY COALESCE(last_seen_at, created_at) DESC, created_at DESC`,
    )
    .all(userId, now) as StoredSession[];
}

/** Revokes one of the account's own sessions by its public handle. */
export function deleteSessionByHandle(userId: string, handle: string): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM sessions WHERE user_id = ? AND handle = ?')
    .run(userId, handle);
  return result.changes > 0;
}

export function deleteOtherSessions(userId: string, keepSessionId: string): number {
  const result = getDatabase()
    .prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
    .run(userId, keepSessionId);
  return Number(result.changes);
}

export function deleteSession(sessionId: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Auth-owned expired-session cleanup. Deletes session rows and pending
 * two-factor challenges whose expiry has passed and returns the removed
 * count. Scheduling lives with the App lifecycle; this function never
 * creates timers.
 */
export function cleanupExpiredSessions(now: number = Date.now()): number {
  const database = getDatabase();
  const sessions = database
    .prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= ?')
    .run(now);
  const challenges = database.prepare('DELETE FROM two_factor_challenges WHERE expires_at <= ?').run(now);
  const resets = database.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?').run(now);
  return Number(sessions.changes) + Number(challenges.changes) + Number(resets.changes);
}

export interface TwoFactorState {
  two_factor_secret: string | null;
  two_factor_pending_secret: string | null;
  two_factor_enabled_at: number | null;
  two_factor_last_step: number | null;
}

export function findTwoFactorState(userId: string): TwoFactorState | undefined {
  return getDatabase()
    .prepare(
      `SELECT two_factor_secret, two_factor_pending_secret, two_factor_enabled_at, two_factor_last_step
       FROM users WHERE id = ?`,
    )
    .get(userId) as TwoFactorState | undefined;
}

export function setPendingTwoFactorSecret(userId: string, secret: string): void {
  getDatabase()
    .prepare('UPDATE users SET two_factor_pending_secret = ?, updated_at = ? WHERE id = ?')
    .run(secret, Date.now(), userId);
}

function insertRecoveryCodes(userId: string, codeHashes: readonly string[], now: number): void {
  const database = getDatabase();
  database.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(userId);
  const insert = database.prepare(
    'INSERT INTO two_factor_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)',
  );
  for (const codeHash of codeHashes) insert.run(randomUUID(), userId, codeHash, now);
}

/** Promotes the pending secret, records the accepted step, and replaces recovery codes atomically. */
export function enableTwoFactor(userId: string, secret: string, acceptedStep: number, codeHashes: readonly string[]): void {
  const database = getDatabase();
  const now = Date.now();
  database.transaction(() => {
    database
      .prepare(
        `UPDATE users
         SET two_factor_secret = ?, two_factor_pending_secret = NULL, two_factor_enabled_at = ?,
             two_factor_last_step = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(secret, now, acceptedStep, now, userId);
    insertRecoveryCodes(userId, codeHashes, now);
  })();
}

export function disableTwoFactor(userId: string): void {
  const database = getDatabase();
  database.transaction(() => {
    database
      .prepare(
        `UPDATE users
         SET two_factor_secret = NULL, two_factor_pending_secret = NULL, two_factor_enabled_at = NULL,
             two_factor_last_step = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), userId);
    database.prepare('DELETE FROM two_factor_recovery_codes WHERE user_id = ?').run(userId);
    database.prepare('DELETE FROM two_factor_challenges WHERE user_id = ?').run(userId);
  })();
}

export function replaceRecoveryCodes(userId: string, codeHashes: readonly string[]): void {
  getDatabase().transaction(() => insertRecoveryCodes(userId, codeHashes, Date.now()))();
}

export function countUnusedRecoveryCodes(userId: string): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND used_at IS NULL')
    .get(userId) as { count: number };
  return row.count;
}

/** Marks a matching unused recovery code as used; false when none matched. */
export function consumeRecoveryCode(userId: string, codeHash: string): boolean {
  const result = getDatabase()
    .prepare(
      'UPDATE two_factor_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
    )
    .run(Date.now(), userId, codeHash);
  return result.changes > 0;
}

/** Advances the replay guard only forward; false when the step was already used. */
export function recordTwoFactorStep(userId: string, step: number): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE users SET two_factor_last_step = ?
       WHERE id = ? AND (two_factor_last_step IS NULL OR two_factor_last_step < ?)`,
    )
    .run(step, userId, step);
  return result.changes > 0;
}

export interface StoredChallenge {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  attempts: number;
  expires_at: number;
}

export function createTwoFactorChallenge(data: {
  id: string;
  userId: string;
  userAgent: string | undefined;
  ipAddress: string | undefined;
  expiresAt: number;
}): void {
  const database = getDatabase();
  database.transaction(() => {
    // One outstanding challenge per account keeps attempt budgets meaningful.
    database.prepare('DELETE FROM two_factor_challenges WHERE user_id = ?').run(data.userId);
    database
      .prepare(
        `INSERT INTO two_factor_challenges (id, user_id, user_agent, ip_address, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(data.id, data.userId, data.userAgent ?? null, data.ipAddress ?? null, data.expiresAt, Date.now());
  })();
}

export function findTwoFactorChallenge(id: string, now: number = Date.now()): StoredChallenge | undefined {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, user_agent, ip_address, attempts, expires_at
       FROM two_factor_challenges WHERE id = ? AND expires_at > ?`,
    )
    .get(id, now) as StoredChallenge | undefined;
}

/** Records a failed attempt and returns the new attempt count. */
export function recordChallengeFailure(id: string): number {
  const row = getDatabase()
    .prepare('UPDATE two_factor_challenges SET attempts = attempts + 1 WHERE id = ? RETURNING attempts')
    .get(id) as { attempts: number } | undefined;
  return row?.attempts ?? Number.POSITIVE_INFINITY;
}

export function deleteTwoFactorChallenge(id: string): void {
  getDatabase().prepare('DELETE FROM two_factor_challenges WHERE id = ?').run(id);
}

/** Issues a reset token for the account, replacing any it still had. */
export function createPasswordResetToken(data: { id: string; userId: string; tokenHash: string; expiresAt: number }): void {
  const database = getDatabase();
  database.transaction(() => {
    database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(data.userId);
    database
      .prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(data.id, data.userId, data.tokenHash, data.expiresAt, Date.now());
  })();
}

/**
 * Spends an unused, unexpired reset token: sets the password, marks the token
 * used, and ends every session of the account, all at once. Answers the
 * account id, or undefined when the token does not work.
 */
export function redeemPasswordResetToken(tokenHash: string, passwordHash: string, now: number = Date.now()): string | undefined {
  const database = getDatabase();
  return database.transaction(() => {
    const token = database
      .prepare('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(tokenHash, now) as { id: string; user_id: string } | undefined;
    if (!token) return undefined;
    const updated = database
      .prepare('UPDATE users SET password = ?, must_change_password = 0, password_usable = 1, updated_at = ? WHERE id = ?')
      .run(passwordHash, now, token.user_id);
    if (updated.changes === 0) return undefined;
    database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, token.id);
    database.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?').run(token.user_id, token.id);
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(token.user_id);
    return token.user_id;
  })();
}

export type ApiTokenScope = 'read' | 'write';

export interface StoredApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
}

/** A token found by its hash, with what the bearer pipeline needs of its account. */
export interface ApiTokenOwner {
  id: string;
  user_id: string;
  scope: ApiTokenScope;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
  user_name: string;
  user_email: string;
  must_change_password: number;
}

const ACTIVE_API_TOKEN = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';

/**
 * Stores a new token unless the account already holds `maxActive` working
 * ones (expired and revoked tokens do not count). Answers whether it stored it.
 */
export function createApiToken(
  data: { id: string; userId: string; name: string; tokenHash: string; prefix: string; scope: ApiTokenScope; expiresAt: number | null },
  maxActive: number,
  now: number = Date.now(),
): boolean {
  const database = getDatabase();
  return database.transaction(() => {
    const { active } = database
      .prepare(`SELECT COUNT(*) AS active FROM api_tokens WHERE user_id = ? AND ${ACTIVE_API_TOKEN}`)
      .get(data.userId, now) as { active: number };
    if (active >= maxActive) return false;
    database
      .prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scope, expires_at, last_used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(data.id, data.userId, data.name, data.tokenHash, data.prefix, data.scope, data.expiresAt, now);
    return true;
  })();
}

/** The account's tokens that are not revoked, expired ones included, newest first. */
export function listApiTokens(userId: string): StoredApiToken[] {
  return getDatabase()
    .prepare(
      `SELECT id, name, prefix, scope, expires_at, last_used_at, created_at
       FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(userId) as StoredApiToken[];
}

export function findApiTokenByHash(tokenHash: string): ApiTokenOwner | undefined {
  return getDatabase()
    .prepare(
      `SELECT t.id, t.user_id, t.scope, t.expires_at, t.last_used_at, t.revoked_at,
              u.name AS user_name, u.email AS user_email, u.must_change_password
       FROM api_tokens t
       INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .get(tokenHash) as ApiTokenOwner | undefined;
}

export function touchApiToken(id: string, now: number): void {
  getDatabase().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, id);
}

/** Revokes one of the account's own tokens that is not revoked yet; answers it, or undefined. */
export function revokeApiToken(userId: string, id: string, now: number = Date.now()): StoredApiToken | undefined {
  const database = getDatabase();
  return database.transaction(() => {
    const token = database
      .prepare(
        `SELECT id, name, prefix, scope, expires_at, last_used_at, created_at
         FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .get(id, userId) as StoredApiToken | undefined;
    if (!token) return undefined;
    database.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(now, id);
    return token;
  })();
}

export function revokeAllApiTokens(userId: string, now: number = Date.now()): number {
  return Number(
    getDatabase().prepare('UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId).changes,
  );
}

/** Removes tokens revoked or expired at or before `cutoff`; until then they keep answering why they stopped working. */
export function purgeApiTokens(cutoff: number): number {
  return Number(
    getDatabase()
      .prepare(
        `DELETE FROM api_tokens
         WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR (expires_at IS NOT NULL AND expires_at <= ?)`,
      )
      .run(cutoff, cutoff).changes,
  );
}
