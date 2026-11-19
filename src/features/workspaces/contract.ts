import { z } from 'zod';
import type { ApiOperation } from '../../shared/security/api-operations';
import { API_REFUSAL_CODES, API_TOKEN_REFUSAL_CODES } from '../../shared/security/codes';
import { CONTROL_MESSAGE, emailSchema, hasNoControlChars } from '../../shared/security/input';
import { pageQueryShape } from '../../shared/security/pagination';

export const featureName = 'workspaces' as const;
export type FeatureName = typeof featureName;

/** Live update topic: a workspace, its members or its invitations changed; refetch the list and the open workspace. */
export const WORKSPACES_CHANGED_EVENT = 'workspaces.changed';
/** Live update topic: a chat message was posted in a workspace of the account; refetch its messages. */
export const WORKSPACES_CHAT_EVENT = 'workspaces.chat';

/** How many chat messages a workspace's chat returns: the latest ones, oldest first. */
export const WORKSPACE_CHAT_LIMIT = 50;
/** How long an invitation can be answered. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Notification types Workspaces sends, with the data each carries. */
export const WORKSPACE_NOTIFICATION_TYPES = {
  /** To the invitee: `{ workspace_id, workspace_name, inviter_name, token }`. */
  invitation: 'workspace_invitation',
  /** To the inviter: `{ workspace_id, workspace_name, accepter_name }`. */
  invitationAccepted: 'invitation_accepted',
} as const;

export const STALE_REVISION = 'STALE_REVISION' as const;

/** Refusals Workspaces adds to the shared API codes. */
export const WORKSPACES_REFUSAL_CODES = [
  'WORKSPACE_NOT_FOUND',
  'ACCOUNT_NOT_FOUND',
  'ALREADY_MEMBER',
  'INVITATION_PENDING',
  'INVITATION_NOT_FOUND',
  'INVITATION_NOT_PENDING',
  'INVITATION_EXPIRED',
  'MEMBER_NOT_FOUND',
  'OWNER_CANNOT_LEAVE',
  STALE_REVISION,
] as const;

export type WorkspacesRefusalCode = (typeof WORKSPACES_REFUSAL_CODES)[number];

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(255, 'Name must be at most 255 characters')
  .refine(hasNoControlChars, { message: `Name ${CONTROL_MESSAGE}` });

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, 'Description must be at most 2000 characters')
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const createWorkspaceInputSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
});

export const updateWorkspaceInputSchema = z
  .object({
    /** The revision the edit was based on; a newer one refuses it with `STALE_REVISION`. */
    revision: z.number().int().positive(),
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.description !== undefined, {
    message: 'Nothing to update',
    path: ['name'],
  });

export const inviteMemberInputSchema = z.object({ email: emailSchema });

export const respondInvitationInputSchema = z.object({ action: z.enum(['accept', 'decline']) });

export const postMessageInputSchema = z.object({
  message: z.string().trim().min(1, 'Message must not be empty').max(2000, 'Message must be at most 2000 characters'),
});

/** The public API's workspace list: the caller's workspaces, newest first. */
export const apiWorkspacesQuerySchema = z.object({ ...pageQueryShape });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;
export type RespondInvitationInput = z.infer<typeof respondInvitationInputSchema>;
export type PostMessageInput = z.infer<typeof postMessageInputSchema>;

/**
 * Response schemas, built on demand: routes type their responses against them
 * and contract tests parse real responses with them. Strict, so an undeclared
 * field fails.
 */
export function workspacesResponseSchemas() {
  const success = <T extends z.ZodType>(data: T) =>
    z.strictObject({ success: z.literal(true), message: z.string(), data });

  const person = z.strictObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    avatar: z.string().nullable(),
  });
  const role = z.enum(['owner', 'member']);
  const workspace = z.strictObject({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    owner_id: z.string(),
    revision: z.number(),
    created_at: z.number(),
    updated_at: z.number(),
  });
  const workspaceSummary = z.strictObject({
    ...workspace.shape,
    /** The signed-in account's role in it. */
    role,
    member_count: z.number(),
    project_count: z.number(),
  });
  const member = z.strictObject({
    user: person,
    role,
    joined_at: z.number(),
  });
  const invitation = z.strictObject({
    id: z.string(),
    invitee_email: z.string(),
    inviter: person.nullable(),
    status: z.enum(['pending', 'accepted', 'declined']),
    expires_at: z.number(),
    created_at: z.number(),
  });
  const receivedInvitation = z.strictObject({
    id: z.string(),
    token: z.string(),
    workspace: z.strictObject({ id: z.string(), name: z.string() }),
    inviter: person.nullable(),
    expires_at: z.number(),
    created_at: z.number(),
  });
  const message = z.strictObject({
    id: z.string(),
    workspace_id: z.string(),
    message: z.string(),
    user: person.nullable(),
    created_at: z.number(),
  });
  const error = z.strictObject({
    success: z.literal(false),
    message: z.string(),
    code: z.enum([...API_REFUSAL_CODES, ...WORKSPACES_REFUSAL_CODES]),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  });

  return {
    person,
    workspace,
    workspaceSummary,
    member,
    invitation,
    receivedInvitation,
    message,
    error,
    /** 409 for an edit based on an older revision; `current` is the workspace as it is now. */
    staleWorkspace: z.strictObject({ ...error.shape, code: z.literal(STALE_REVISION), current: workspace }),
    done: z.strictObject({ success: z.literal(true), message: z.string() }),
    workspaces: success(z.strictObject({ workspaces: z.array(workspaceSummary) })),
    workspaceSaved: success(z.strictObject({ workspace })),
    workspaceDetail: success(
      z.strictObject({
        workspace: workspaceSummary,
        members: z.array(member),
        /** Pending invitations of the workspace. */
        invitations: z.array(invitation),
      }),
    ),
    invitationSent: success(z.strictObject({ invitation })),
    receivedInvitations: success(z.strictObject({ invitations: z.array(receivedInvitation) })),
    invitationAnswered: success(z.strictObject({ workspace_id: z.string(), status: z.enum(['accepted', 'declined']) })),
    messages: success(z.strictObject({ messages: z.array(message) })),
    messagePosted: success(z.strictObject({ message })),
    /** Public API (`/api/v1`) refusals: the bearer pipeline's codes join the shared and Workspaces ones. */
    apiError: z.strictObject({
      ...error.shape,
      code: z.enum([...API_REFUSAL_CODES, ...API_TOKEN_REFUSAL_CODES, ...WORKSPACES_REFUSAL_CODES]),
    }),
    apiWorkspaces: success(
      z.strictObject({
        workspaces: z.array(workspaceSummary),
        /** Send it back as `cursor` for the next page; `null` on the last page. */
        next_cursor: z.string().nullable(),
      }),
    ),
    apiWorkspace: success(z.strictObject({ workspace: workspaceSummary })),
    /** The owner first, then members in joining order. */
    apiMembers: success(z.strictObject({ members: z.array(member) })),
  };
}

/**
 * The public API's workspace operations, as mounted under `/api/v1`. The
 * application's OpenAPI document is built from them, and a test checks them
 * against the mounted routes and their real answers.
 */
export function workspacesApiV1(): ApiOperation[] {
  const schemas = workspacesResponseSchemas();
  return [
    {
      method: 'get',
      path: '/workspaces',
      summary: 'List your workspaces',
      description: 'The workspaces the token\'s account belongs to, newest first.',
      query: apiWorkspacesQuerySchema,
      responses: { 200: schemas.apiWorkspaces },
    },
    {
      method: 'get',
      path: '/workspaces/:id',
      summary: 'Get a workspace',
      responses: { 200: schemas.apiWorkspace },
      refusals: { 403: ['FORBIDDEN'], 404: ['WORKSPACE_NOT_FOUND'] },
    },
    {
      method: 'get',
      path: '/workspaces/:id/members',
      summary: 'List a workspace\'s members',
      responses: { 200: schemas.apiMembers },
      refusals: { 403: ['FORBIDDEN'], 404: ['WORKSPACE_NOT_FOUND'] },
    },
  ];
}

type WorkspacesResponseSchemas = ReturnType<typeof workspacesResponseSchemas>;
type Infer<K extends keyof WorkspacesResponseSchemas> = z.infer<WorkspacesResponseSchemas[K]>;

export type WorkspacePerson = Infer<'person'>;
export type Workspace = Infer<'workspace'>;
export type WorkspaceSummary = Infer<'workspaceSummary'>;
export type WorkspaceMember = Infer<'member'>;
export type WorkspaceInvitation = Infer<'invitation'>;
export type ReceivedInvitation = Infer<'receivedInvitation'>;
export type WorkspaceMessage = Infer<'message'>;
export type WorkspacesError = Infer<'error'>;
export type StaleWorkspaceError = Infer<'staleWorkspace'>;
export type WorkspacesDone = Infer<'done'>;
export type WorkspacesSuccess = Infer<'workspaces'>;
export type WorkspaceSavedSuccess = Infer<'workspaceSaved'>;
export type WorkspaceDetailSuccess = Infer<'workspaceDetail'>;
export type InvitationSentSuccess = Infer<'invitationSent'>;
export type ReceivedInvitationsSuccess = Infer<'receivedInvitations'>;
export type InvitationAnsweredSuccess = Infer<'invitationAnswered'>;
export type WorkspaceMessagesSuccess = Infer<'messages'>;
export type MessagePostedSuccess = Infer<'messagePosted'>;
export type WorkspacesApiError = Infer<'apiError'>;
export type ApiWorkspacesSuccess = Infer<'apiWorkspaces'>;
export type ApiWorkspaceSuccess = Infer<'apiWorkspace'>;
export type ApiWorkspaceMembersSuccess = Infer<'apiMembers'>;

export type WorkspacesResponse = WorkspacesSuccess | WorkspacesError;
export type WorkspaceSavedResponse = WorkspaceSavedSuccess | WorkspacesError;
export type UpdateWorkspaceResponse = WorkspaceSavedSuccess | StaleWorkspaceError | WorkspacesError;
export type WorkspaceDetailResponse = WorkspaceDetailSuccess | WorkspacesError;
export type WorkspacesDoneResponse = WorkspacesDone | WorkspacesError;
export type InvitationSentResponse = InvitationSentSuccess | WorkspacesError;
export type ReceivedInvitationsResponse = ReceivedInvitationsSuccess | WorkspacesError;
export type InvitationAnsweredResponse = InvitationAnsweredSuccess | WorkspacesError;
export type WorkspaceMessagesResponse = WorkspaceMessagesSuccess | WorkspacesError;
export type MessagePostedResponse = MessagePostedSuccess | WorkspacesError;
