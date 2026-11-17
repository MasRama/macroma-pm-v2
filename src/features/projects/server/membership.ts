import { getDatabase } from '../../../shared/database';
import { projectAudiences } from './access';
import type { ProjectsServerHost } from './host';
import { announceProjectChange } from './live';
import {
  detachWorkspaceRows,
  findProject,
  forgetAccountRows,
  projectCountsByWorkspace,
  projectIdsOwnedBy,
  projectIdsWithMembers,
} from './repository';
import type { Project } from '../contract';

/** How many projects each workspace holds; workspaces without any are left out. */
export function workspaceProjectCounts(workspaceIds: readonly string[]): Record<string, number> {
  return projectCountsByWorkspace(workspaceIds);
}

/**
 * The projects of a deleted workspace stay, without a workspace, as V1's
 * `ON DELETE SET NULL` did. Their direct members are told; the workspace's
 * members hear of it through the workspace's own change.
 */
export function detachWorkspace(host: ProjectsServerHost, workspaceId: string): void {
  const detached = detachWorkspaceRows(workspaceId)
    .map((id) => findProject(id))
    .filter((project): project is Project => project !== undefined);
  const audiences = projectAudiences(host, detached);
  announceProjectChange([...audiences.values()].flatMap((audience) => [...audience]));
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
