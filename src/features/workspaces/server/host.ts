import type { WorkspacePerson } from '../contract';

export type WorkspaceNotificationData = Record<string, string | number | boolean | null>;

/**
 * What Workspaces needs but does not own. The application binding supplies
 * accounts from its identity provider, notifications, and the projects that
 * live in a workspace; Workspaces never imports those Features.
 */
export interface WorkspacesServerHost {
  readonly sessionCookieName: string;
  resolveActor(sessionToken: string | undefined): { id: string; name: string; email: string } | undefined;
  /** The accounts that exist among the ids; one call for any number of them. */
  findAccountsByIds(userIds: readonly string[]): WorkspacePerson[];
  /** The account using the email, ignoring case. */
  findAccountByEmail(email: string): WorkspacePerson | undefined;
  notify(userId: string, type: string, data: WorkspaceNotificationData): void;
  /** Withdraws the notifications of `type` whose data `field` equals `value`. */
  withdrawNotifications(type: string, field: string, value: string): void;
  /** How many projects each workspace holds; workspaces without any may be left out. */
  projectCounts(workspaceIds: readonly string[]): Record<string, number>;
  /** Runs inside the transaction that deletes the workspace; its projects stay, without a workspace. */
  workspaceDeleted(workspaceId: string): void;
}
