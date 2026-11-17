import { computed, ref } from 'vue';
import { createProjectsList } from '../features/projects/web';
import { createWorkspacesList } from '../features/workspaces/web';
import { projectsClient, workspacesClient } from './api-clients';

/*
 * What the app shell keeps while someone is signed in and the routed pages
 * read too: the account's workspaces and projects (AppShell starts and stops
 * their live refresh), the workspace in view, and the "Workspace baru" modal.
 */
export const workspaceList = createWorkspacesList(workspacesClient);
export const projectList = createProjectsList(projectsClient);

/** Set by AppShell: the open workspace page, else the last one used, else the first. */
export const currentWorkspaceId = ref<string | null>(null);
export const currentWorkspace = computed(
  () => workspaceList.items.value.find((workspace) => workspace.id === currentWorkspaceId.value) ?? null,
);

export const newWorkspaceOpen = ref(false);

export function workspaceNameOf(id: string): string | undefined {
  return workspaceList.items.value.find((workspace) => workspace.id === id)?.name;
}
