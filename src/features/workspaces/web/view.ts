import type { PersonRef } from '../../../shared/ui';
import type { BatchVersion } from '../../projects/web';

/* Shapes the workspace page and chat drawer render; the API client maps onto them. */

export type WorkspaceRole = 'owner' | 'member';

export interface WorkspaceSummary {
  id: number;
  name: string;
  description?: string | null;
}

export interface WorkspaceMember {
  person: PersonRef;
  email: string;
  role: WorkspaceRole;
}

export interface PendingInvite {
  id: number;
  email: string;
  sentAt: string;
}

export interface WorkspaceProjectCard {
  id: number;
  name: string;
  description?: string | null;
  batch?: BatchVersion | null;
  done: number;
  total: number;
  members: PersonRef[];
}

export interface ChatMessage {
  id: number;
  author: PersonRef;
  body: string;
  at: string;
}

export interface NewWorkspaceInput {
  name: string;
  description: string;
}
