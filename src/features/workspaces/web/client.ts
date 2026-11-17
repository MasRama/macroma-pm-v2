import { hc } from 'hono/client';
import type {
  CreateWorkspaceInput,
  InvitationAnsweredResponse,
  InvitationSentResponse,
  InviteMemberInput,
  MessagePostedResponse,
  PostMessageInput,
  ReceivedInvitationsResponse,
  RespondInvitationInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceResponse,
  WorkspaceDetailResponse,
  WorkspaceMessagesResponse,
  WorkspaceSavedResponse,
  WorkspacesDoneResponse,
  WorkspacesResponse,
} from '../contract';
import type { createInvitationRoutes, createWorkspaceRoutes } from '..';

/** CSRF provider for state-changing requests; the application binds it to its identity provider. */
export interface WorkspacesWebCsrf {
  headers(extra?: HeadersInit): Record<string, string>;
  ensureToken(): Promise<unknown>;
}

export interface WorkspacesClient {
  list(): Promise<WorkspacesResponse>;
  create(input: CreateWorkspaceInput): Promise<WorkspaceSavedResponse>;
  /** The workspace with its members and pending invitations. */
  get(id: string): Promise<WorkspaceDetailResponse>;
  update(id: string, input: UpdateWorkspaceInput): Promise<UpdateWorkspaceResponse>;
  remove(id: string): Promise<WorkspacesDoneResponse>;
  invite(id: string, input: InviteMemberInput): Promise<InvitationSentResponse>;
  cancelInvitation(id: string, invitationId: string): Promise<WorkspacesDoneResponse>;
  /** Removes a member (owner), or leaves the workspace when `userId` is the caller. */
  removeMember(id: string, userId: string): Promise<WorkspacesDoneResponse>;
  messages(id: string): Promise<WorkspaceMessagesResponse>;
  postMessage(id: string, input: PostMessageInput): Promise<MessagePostedResponse>;
  /** Pending invitations sent to the signed-in account. */
  receivedInvitations(): Promise<ReceivedInvitationsResponse>;
  respondInvitation(token: string, input: RespondInvitationInput): Promise<InvitationAnsweredResponse>;
}

export interface WorkspacesClientOptions {
  baseUrl?: string;
  invitationsBaseUrl?: string;
  /** Without it, writes reach the server without a CSRF token and fail closed there. */
  csrf?: WorkspacesWebCsrf;
}

export function createWorkspacesClient(options: WorkspacesClientOptions = {}): WorkspacesClient {
  const { baseUrl = '/api/workspaces', invitationsBaseUrl = '/api/invitations', csrf } = options;
  const apiFetch: typeof fetch = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') await csrf?.ensureToken();
    return fetch(input, { ...init, credentials: 'include', headers: csrf ? csrf.headers(init.headers) : init.headers });
  };
  const workspaces = hc<ReturnType<typeof createWorkspaceRoutes>>(baseUrl.replace(/\/$/, ''), { fetch: apiFetch });
  const invitations = hc<ReturnType<typeof createInvitationRoutes>>(invitationsBaseUrl.replace(/\/$/, ''), { fetch: apiFetch });

  return {
    list: async () => (await workspaces.index.$get()).json(),
    create: async (input) => (await workspaces.index.$post({ json: input })).json(),
    get: async (id) => (await workspaces[':id'].$get({ param: { id } })).json(),
    update: async (id, input) => (await workspaces[':id'].$patch({ param: { id }, json: input })).json(),
    remove: async (id) => (await workspaces[':id'].$delete({ param: { id } })).json(),
    invite: async (id, input) => (await workspaces[':id'].invitations.$post({ param: { id }, json: input })).json(),
    cancelInvitation: async (id, invitationId) =>
      (await workspaces[':id'].invitations[':invitationId'].$delete({ param: { id, invitationId } })).json(),
    removeMember: async (id, userId) => (await workspaces[':id'].members[':userId'].$delete({ param: { id, userId } })).json(),
    messages: async (id) => (await workspaces[':id'].messages.$get({ param: { id } })).json(),
    postMessage: async (id, input) => (await workspaces[':id'].messages.$post({ param: { id }, json: input })).json(),
    receivedInvitations: async () => (await invitations.index.$get()).json(),
    respondInvitation: async (token, input) => (await invitations[':token'].respond.$post({ param: { token }, json: input })).json(),
  };
}
