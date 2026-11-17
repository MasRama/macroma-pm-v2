import { randomBytes, randomUUID } from 'node:crypto';
import { getDatabase } from '../../../shared/database';
import { INVITATION_TTL_MS, WORKSPACE_CHAT_LIMIT, type Workspace } from '../contract';

export type WorkspaceRole = 'owner' | 'member';
export type InvitationStatus = 'pending' | 'accepted' | 'declined';

export interface MemberRow {
  user_id: string;
  role: WorkspaceRole;
  created_at: number;
}

export interface InvitationRow {
  id: string;
  workspace_id: string;
  inviter_id: string;
  invitee_email: string;
  token: string;
  status: InvitationStatus;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface ReceivedInvitationRow extends InvitationRow {
  workspace_name: string;
}

export interface MessageRow {
  id: string;
  workspace_id: string;
  user_id: string;
  message: string;
  created_at: number;
}

export interface WorkspaceListRow extends Workspace {
  role: WorkspaceRole;
  member_count: number;
}

const WORKSPACE_COLUMNS = 'w.id, w.name, w.description, w.owner_id, w.revision, w.created_at, w.updated_at';

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

export function findWorkspace(id: string): Workspace | undefined {
  return getDatabase().prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces w WHERE w.id = ?`).get(id) as Workspace | undefined;
}

export function createWorkspace(input: { name: string; description: string | null; ownerId: string }): Workspace {
  const database = getDatabase();
  const now = Date.now();
  const workspace: Workspace = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    owner_id: input.ownerId,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO workspaces (id, name, description, owner_id, revision, created_at, updated_at)
         VALUES (@id, @name, @description, @owner_id, @revision, @created_at, @updated_at)`,
      )
      .run(workspace);
    addMember(workspace.id, input.ownerId, 'owner', now);
  })();
  return workspace;
}

/** The workspaces the account belongs to, newest first, with its role and the member count. */
export function listWorkspacesForUser(userId: string): WorkspaceListRow[] {
  return getDatabase()
    .prepare(
      `SELECT ${WORKSPACE_COLUMNS}, m.role AS role,
         (SELECT COUNT(*) FROM workspace_members c WHERE c.workspace_id = w.id) AS member_count
       FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?
       ORDER BY w.created_at DESC, w.id`,
    )
    .all(userId) as WorkspaceListRow[];
}

export function countMembers(workspaceId: string): number {
  return (getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?').get(workspaceId) as { count: number }).count;
}

export type WorkspaceUpdate =
  | { status: 'updated'; workspace: Workspace }
  | { status: 'stale'; workspace: Workspace }
  | { status: 'missing' };

export function updateWorkspace(
  id: string,
  patch: { name?: string; description?: string | null },
  revision: number,
): WorkspaceUpdate {
  const database = getDatabase();
  return database.transaction((): WorkspaceUpdate => {
    const current = findWorkspace(id);
    if (!current) return { status: 'missing' };
    if (current.revision !== revision) return { status: 'stale', workspace: current };
    const next: Workspace = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      revision: current.revision + 1,
      updated_at: Date.now(),
    };
    database
      .prepare('UPDATE workspaces SET name = @name, description = @description, revision = @revision, updated_at = @updated_at WHERE id = @id')
      .run(next);
    return { status: 'updated', workspace: next };
  })();
}

/** The tokens of the pending invitations of these workspaces, read before a deletion takes them. */
function pendingTokensOfWorkspaces(workspaceIds: readonly string[]): string[] {
  if (workspaceIds.length === 0) return [];
  return (
    getDatabase()
      .prepare(`SELECT token FROM workspace_invitations WHERE status = 'pending' AND workspace_id IN (${placeholders(workspaceIds)})`)
      .all(...workspaceIds) as Array<{ token: string }>
  ).map((row) => row.token);
}

/** Deletes the workspace with everything inside; returns the tokens of the pending invitations it took. */
export function deleteWorkspace(id: string): string[] {
  const tokens = pendingTokensOfWorkspaces([id]);
  getDatabase().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  return tokens;
}

export function memberRole(workspaceId: string, userId: string): WorkspaceRole | undefined {
  const row = getDatabase()
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as { role: WorkspaceRole } | undefined;
  return row?.role;
}

export function listMembers(workspaceId: string): MemberRow[] {
  return getDatabase()
    .prepare(
      `SELECT user_id, role, created_at FROM workspace_members WHERE workspace_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at, user_id`,
    )
    .all(workspaceId) as MemberRow[];
}

export function memberIds(workspaceId: string): string[] {
  return (getDatabase().prepare('SELECT user_id FROM workspace_members WHERE workspace_id = ?').all(workspaceId) as Array<{ user_id: string }>).map(
    (row) => row.user_id,
  );
}

export function workspaceIdsForUser(userId: string): string[] {
  return (getDatabase().prepare('SELECT workspace_id FROM workspace_members WHERE user_id = ?').all(userId) as Array<{ workspace_id: string }>).map(
    (row) => row.workspace_id,
  );
}

/** When each of the account's workspaces was created. */
export function workspaceOpeningsForUser(userId: string): number[] {
  return (
    getDatabase()
      .prepare('SELECT w.created_at FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id WHERE m.user_id = ?')
      .all(userId) as Array<{ created_at: number }>
  ).map((row) => row.created_at);
}

/** Adds the account unless it already belongs; whether it was added. */
export function addMember(workspaceId: string, userId: string, role: WorkspaceRole, createdAt = Date.now()): boolean {
  return (
    getDatabase()
      .prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      )
      .run(randomUUID(), workspaceId, userId, role, createdAt).changes > 0
  );
}

export function removeMember(workspaceId: string, userId: string): boolean {
  return getDatabase().prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId).changes > 0;
}

/** An unexpired pending invitation of the email to the workspace. */
export function hasOpenInvitation(workspaceId: string, email: string, now = Date.now()): boolean {
  return (
    getDatabase()
      .prepare(
        `SELECT 1 FROM workspace_invitations
         WHERE workspace_id = ? AND invitee_email = ? AND status = 'pending' AND expires_at > ?`,
      )
      .get(workspaceId, email, now) !== undefined
  );
}

/** Sends an invitation; returns it with the tokens of the expired ones it replaced. */
export function createInvitation(input: { workspaceId: string; inviterId: string; email: string }): {
  invitation: InvitationRow;
  replacedTokens: string[];
} {
  const database = getDatabase();
  const now = Date.now();
  const row: InvitationRow = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    inviter_id: input.inviterId,
    invitee_email: input.email,
    token: randomBytes(32).toString('hex'),
    status: 'pending',
    expires_at: now + INVITATION_TTL_MS,
    created_at: now,
    updated_at: now,
  };
  const replaced = database.transaction(() => {
    // An expired invitation of the same email is replaced, not kept beside the new one.
    const expired = (
      database
        .prepare(`DELETE FROM workspace_invitations WHERE workspace_id = ? AND invitee_email = ? AND status = 'pending' AND expires_at <= ? RETURNING token`)
        .all(input.workspaceId, input.email, now) as Array<{ token: string }>
    ).map((entry) => entry.token);
    database
      .prepare(
        `INSERT INTO workspace_invitations (id, workspace_id, inviter_id, invitee_email, token, status, expires_at, created_at, updated_at)
         VALUES (@id, @workspace_id, @inviter_id, @invitee_email, @token, @status, @expires_at, @created_at, @updated_at)`,
      )
      .run(row);
    return expired;
  })();
  return { invitation: row, replacedTokens: replaced };
}

const INVITATION_COLUMNS = 'id, workspace_id, inviter_id, invitee_email, token, status, expires_at, created_at, updated_at';

export function findInvitation(id: string): InvitationRow | undefined {
  return getDatabase().prepare(`SELECT ${INVITATION_COLUMNS} FROM workspace_invitations WHERE id = ?`).get(id) as InvitationRow | undefined;
}

export function findInvitationByToken(token: string): InvitationRow | undefined {
  return getDatabase().prepare(`SELECT ${INVITATION_COLUMNS} FROM workspace_invitations WHERE token = ?`).get(token) as
    | InvitationRow
    | undefined;
}

export function listPendingInvitations(workspaceId: string): InvitationRow[] {
  return getDatabase()
    .prepare(`SELECT ${INVITATION_COLUMNS} FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending' ORDER BY created_at DESC, id`)
    .all(workspaceId) as InvitationRow[];
}

/** The unexpired pending invitations sent to the email, newest first. */
export function listReceivedInvitations(email: string, now = Date.now()): ReceivedInvitationRow[] {
  return getDatabase()
    .prepare(
      `SELECT i.id, i.workspace_id, i.inviter_id, i.invitee_email, i.token, i.status, i.expires_at, i.created_at, i.updated_at,
         w.name AS workspace_name
       FROM workspace_invitations i JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.invitee_email = ? AND i.status = 'pending' AND i.expires_at > ?
       ORDER BY i.created_at DESC, i.id`,
    )
    .all(email, now) as ReceivedInvitationRow[];
}

export function setInvitationStatus(id: string, status: InvitationStatus): void {
  getDatabase().prepare('UPDATE workspace_invitations SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
}

export function deleteInvitation(id: string): void {
  getDatabase().prepare('DELETE FROM workspace_invitations WHERE id = ?').run(id);
}

/** The latest messages of the workspace, oldest first. */
export function listMessages(workspaceId: string, limit = WORKSPACE_CHAT_LIMIT): MessageRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, workspace_id, user_id, message, created_at FROM workspace_messages
       WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(workspaceId, limit) as MessageRow[];
  return rows.reverse();
}

export function insertMessage(input: { workspaceId: string; userId: string; message: string }): MessageRow {
  const now = Date.now();
  const row: MessageRow = { id: randomUUID(), workspace_id: input.workspaceId, user_id: input.userId, message: input.message, created_at: now };
  getDatabase()
    .prepare(
      `INSERT INTO workspace_messages (id, workspace_id, user_id, message, created_at, updated_at)
       VALUES (@id, @workspace_id, @user_id, @message, @created_at, @created_at)`,
    )
    .run(row);
  return row;
}

/**
 * Forgets deleted accounts as V1's foreign keys did: their workspaces go (with
 * everything inside), and so do their memberships, sent invitations and
 * messages. Returns the ids of the workspaces deleted and the tokens of the
 * pending invitations that went with them.
 */
export function forgetAccountRows(userIds: readonly string[]): { workspaces: string[]; invitationTokens: string[] } {
  if (userIds.length === 0) return { workspaces: [], invitationTokens: [] };
  const database = getDatabase();
  const list = placeholders(userIds);
  const owned = (database.prepare(`SELECT id FROM workspaces WHERE owner_id IN (${list})`).all(...userIds) as Array<{ id: string }>).map(
    (row) => row.id,
  );
  const tokens = new Set(pendingTokensOfWorkspaces(owned));
  if (owned.length > 0) database.prepare(`DELETE FROM workspaces WHERE id IN (${placeholders(owned)})`).run(...owned);
  database.prepare(`DELETE FROM workspace_members WHERE user_id IN (${list})`).run(...userIds);
  const sent = database
    .prepare(`DELETE FROM workspace_invitations WHERE inviter_id IN (${list}) RETURNING token, status`)
    .all(...userIds) as Array<{ token: string; status: string }>;
  for (const invitation of sent) if (invitation.status === 'pending') tokens.add(invitation.token);
  database.prepare(`DELETE FROM workspace_messages WHERE user_id IN (${list})`).run(...userIds);
  return { workspaces: owned, invitationTokens: [...tokens] };
}
