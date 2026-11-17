import type { PersonRef } from '../../../shared/ui';
import type { BatchVersion, ProjectSummaryData } from '../../projects/web';
import type {
  WorkspaceInvitation as WorkspaceInvitationRow,
  WorkspaceMember as WorkspaceMemberRow,
  WorkspaceMessage as WorkspaceMessageRow,
  WorkspacePerson as WorkspacePersonRow,
  WorkspaceSummary as WorkspaceSummaryRow,
} from '../contract';

/*
 * Shapes the workspace page, chat drawer and shell render. API rows (snake_case)
 * become these camelCase shapes only through the mappers below; components
 * never read API rows.
 */

export type WorkspaceRole = 'owner' | 'member';

export interface WorkspaceSummary {
  id: string;
  name: string;
  description?: string | null;
  /** The signed-in account's role in it. */
  role?: WorkspaceRole;
  memberCount?: number;
  projectCount?: number;
  /** The revision an edit is based on. */
  revision?: number;
}

export interface WorkspaceMember {
  person: PersonRef;
  email: string;
  role: WorkspaceRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  sentAt: string;
}

export interface WorkspaceProjectCard {
  id: string;
  name: string;
  description?: string | null;
  batch?: BatchVersion | null;
  /** Tasks in Done, of every task of the project. */
  done: number;
  total: number;
  /** Accounts that can open the project. */
  memberCount: number;
}

export interface ChatMessage {
  id: string;
  author: PersonRef;
  body: string;
  at: string;
}

export interface NewWorkspaceInput {
  name: string;
  description: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

function toPerson(row: WorkspacePersonRow): PersonRef {
  return { id: row.id, name: row.name || row.email, avatar: row.avatar };
}

export function toWorkspaceSummary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: row.role,
    memberCount: row.member_count,
    projectCount: row.project_count,
    revision: row.revision,
  };
}

export function toWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMember {
  return { person: toPerson(row.user), email: row.user.email, role: row.role };
}

export function toPendingInvite(row: WorkspaceInvitationRow): PendingInvite {
  return { id: row.id, email: row.invitee_email, sentAt: iso(row.created_at) };
}

/** A project of the workspace, as its card shows it: progress over every task of the project. */
export function toWorkspaceProjectCard(row: ProjectSummaryData): WorkspaceProjectCard {
  const counts = row.task_counts;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    batch: row.active_batch ? { major: row.active_batch.major, minor: row.active_batch.minor } : null,
    done: counts.done,
    total: counts.backlog + counts.ongoing + counts.revisi + counts.review + counts.done,
    memberCount: row.member_count,
  };
}

/** A message whose author's account was deleted keeps its text under a placeholder name. */
export function toChatMessage(row: WorkspaceMessageRow): ChatMessage {
  return {
    id: row.id,
    author: row.user ? toPerson(row.user) : { id: `gone-${row.id}`, name: 'Akun terhapus' },
    body: row.message,
    at: iso(row.created_at),
  };
}
