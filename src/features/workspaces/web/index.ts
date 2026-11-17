/*
 * Browser boundary of the workspaces Feature: the typed API client, live
 * list and chat state, the workspace page (and its presentational view), the chat drawer the app shell opens, the create/invite
 * modals, and their view types. API shapes whose names the view types use
 * are exported with a `Data` suffix.
 */
export { createWorkspacesClient } from './client';
export type { WorkspacesClient, WorkspacesClientOptions, WorkspacesWebCsrf } from './client';
export {
  INVITATION_TTL_MS,
  WORKSPACE_CHAT_LIMIT,
  WORKSPACE_NOTIFICATION_TYPES,
  WORKSPACES_CHANGED_EVENT,
  WORKSPACES_CHAT_EVENT,
  WORKSPACES_REFUSAL_CODES,
} from '../contract';
export type {
  CreateWorkspaceInput,
  InviteMemberInput,
  PostMessageInput,
  ReceivedInvitation,
  RespondInvitationInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember as WorkspaceMemberData,
  WorkspaceMessage,
  WorkspacePerson,
  WorkspacesError,
  WorkspaceSummary as WorkspaceSummaryData,
} from '../contract';
export { default as WorkspacePage } from './pages/WorkspacePage.vue';
export { default as WorkspaceView } from './components/WorkspaceView.vue';
export { createWorkspaceChat, createWorkspacesList } from './live';
export type { WorkspaceChat, WorkspacesList } from './live';
export { default as ChatDrawer } from './components/ChatDrawer.vue';
export { default as InviteMemberModal } from './components/InviteMemberModal.vue';
export { default as MembersPanel } from './components/MembersPanel.vue';
export { default as NewWorkspaceModal } from './components/NewWorkspaceModal.vue';
export { default as ProjectCard } from './components/ProjectCard.vue';
export {
  WORKSPACES_GENERIC_REFUSAL_TEXT,
  WORKSPACES_REFUSAL_TEXT,
  workspacesFieldTexts,
  workspacesRefusalText,
  type WorkspacesRefusal,
} from './refusals';
export * from './view';
