import { getDatabase } from '../../../shared/database';
import { canOpenProject, projectAudiences } from './access';
import type { ProjectsServerHost } from './host';
import { announceBoardChange, announceProjectChange } from './live';
import {
  detachWorkspaceRows,
  findProject,
  forgetAccountRows,
  projectCountsByWorkspace,
  projectIdsOwnedBy,
  projectIdsWithMembers,
  projectsInWorkspace,
  unassignTasks,
} from './repository';
import type { Project } from '../contract';

/** How many projects each workspace holds; workspaces without any are left out. */
export function workspaceProjectCounts(workspaceIds: readonly string[]): Record<string, number> {
  return projectCountsByWorkspace(workspaceIds);
}

function everyone(audiences: Map<string, Set<string>>): string[] {
  return [...audiences.values()].flatMap((audience) => [...audience]);
}

/**
 * Settles accounts that lost a way into the projects: those who can no longer
 * open a project come off its tasks and are told their projects changed, and
 * the boards that lost an assignee are refreshed. Runs inside the caller's
 * transaction, after the access was taken away.
 */
function settleLostAccess(host: ProjectsServerHost, projects: readonly Project[], userIds: readonly string[]): void {
  const lost = new Set<string>();
  const unassigned: Project[] = [];
  const now = Date.now();
  for (const project of projects) {
    const outside = userIds.filter((userId) => !canOpenProject(host, project, userId));
    for (const userId of outside) lost.add(userId);
    if (unassignTasks(project.id, outside, now)) unassigned.push(project);
  }
  announceProjectChange(lost);
  announceBoardChange(everyone(projectAudiences(host, unassigned)));
}

/**
 * The projects of a deleted workspace stay, without a workspace, as V1's
 * `ON DELETE SET NULL` did. Their direct members are told; the workspace's
 * former members who can no longer open them come off their tasks and are
 * told too.
 */
export function detachWorkspace(host: ProjectsServerHost, workspaceId: string, formerMemberIds: readonly string[]): void {
  const detached = detachWorkspaceRows(workspaceId)
    .map((id) => findProject(id))
    .filter((project): project is Project => project !== undefined);
  announceProjectChange(everyone(projectAudiences(host, detached)));
  settleLostAccess(host, detached, formerMemberIds);
}

/**
 * Accounts that left or were removed from a workspace lose its projects,
 * unless they are direct members: they come off those projects' tasks and
 * are told their projects changed.
 */
export function workspaceMembersLeft(host: ProjectsServerHost, workspaceId: string, userIds: readonly string[]): void {
  settleLostAccess(host, projectsInWorkspace(workspaceId), userIds);
}

/**
 * Forgets deleted accounts the way V1's foreign keys did: the projects they
 * owned go with everything inside, their memberships go, and their names come
 * off tasks, logs and the activity feed.
 */
export function forgetAccounts(host: ProjectsServerHost, userIds: readonly string[]): void {
  if (userIds.length === 0) return;
  const touched = getDatabase().transaction(() => {
    const projects = [...new Set([...projectIdsOwnedBy(userIds), ...projectIdsWithMembers(userIds)])]
      .map((id) => findProject(id))
      .filter((project): project is Project => project !== undefined);
    const audience = new Set([...projectAudiences(host, projects).values()].flatMap((members) => [...members]));
    forgetAccountRows(userIds);
    return audience;
  })();
  for (const userId of userIds) touched.delete(userId);
  announceProjectChange(touched);
}
