import type { AssetStorage } from '../../../shared/storage';
import type { PROJECTS_NOTIFICATION_TYPES, ProjectPerson, TaskMovedNotificationData } from '../contract';

/**
 * What Projects needs but does not own. The application binding supplies
 * accounts from its identity provider and workspace membership from
 * Workspaces; Projects never imports those Features.
 */
export interface ProjectsServerHost {
  readonly sessionCookieName: string;
  resolveActor(sessionToken: string | undefined): { id: string; name: string; email: string } | undefined;
  /** The accounts that exist among the ids; one call for any number of them. */
  findAccountsByIds(userIds: readonly string[]): ProjectPerson[];
  /** The account using the email, ignoring case. */
  findAccountByEmail(email: string): ProjectPerson | undefined;
  /** Whether the account belongs to the workspace, as owner or member. */
  isWorkspaceMember(workspaceId: string, userId: string): boolean;
  /** Every account of the workspace. */
  workspaceMemberIds(workspaceId: string): string[];
  /** The workspaces the account belongs to. */
  workspacesOf(userId: string): string[];
  /** When each of the account's workspaces was created, for the dashboard's trends. */
  workspaceOpenings(userId: string): number[];
  /** Where task images are stored, under `task-attachments/`. */
  readonly assetStorage: AssetStorage;
  /** Creates a notification for the account and tells its open pages; runs inside the caller's transaction. */
  notify(userId: string, type: typeof PROJECTS_NOTIFICATION_TYPES.taskMoved, data: TaskMovedNotificationData): void;
}
