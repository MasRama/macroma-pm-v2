import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import {
  createWorkspaceInputSchema,
  inviteMemberInputSchema,
  postMessageInputSchema,
  respondInvitationInputSchema,
  STALE_REVISION,
  updateWorkspaceInputSchema,
  WORKSPACE_NOTIFICATION_TYPES,
  type InvitationAnsweredSuccess,
  type InvitationSentSuccess,
  type MessagePostedSuccess,
  type ReceivedInvitationsSuccess,
  type Workspace,
  type WorkspaceDetailSuccess,
  type WorkspaceInvitation,
  type WorkspaceMessage,
  type WorkspaceMessagesSuccess,
  type WorkspacePerson,
  type WorkspacesDone,
  type WorkspaceSavedSuccess,
  type WorkspacesRefusalCode,
  type WorkspacesSuccess,
  type WorkspaceSummary,
} from '../contract';
import { getDatabase } from '../../../shared/database';
import { createGuard, forbidden, jsonInput } from '../../../shared/security';
import type { WorkspacesServerHost } from './host';
import { announceChatMessage, announceWorkspaceChange, workspacesChangedTopic, workspacesChatTopic } from './live';
import {
  addMember,
  createInvitation,
  createWorkspace,
  deleteInvitation,
  deleteWorkspace,
  findInvitation,
  findInvitationByToken,
  findWorkspace,
  hasOpenInvitation,
  insertMessage,
  listMembers,
  listMessages,
  listPendingInvitations,
  listReceivedInvitations,
  listWorkspacesForUser,
  memberIds,
  memberRole,
  removeMember,
  setInvitationStatus,
  updateWorkspace,
  type InvitationRow,
  type MessageRow,
  type WorkspaceRole,
} from './repository';

function refuse<C extends WorkspacesRefusalCode>(context: Context, status: 404 | 409, code: C, message: string) {
  return context.json({ success: false as const, message, code }, status);
}

function workspaceNotFound(context: Context) {
  return refuse(context, 404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
}

export function createWorkspaceRoutes(host: WorkspacesServerHost) {
  // Declared with the routes, so the application knows the topics once composed.
  workspacesChangedTopic();
  workspacesChatTopic();
  const guard = createGuard((context) => host.resolveActor(getCookie(context, host.sessionCookieName)));

  function people(userIds: readonly string[]): Map<string, WorkspacePerson> {
    return new Map(host.findAccountsByIds(userIds).map((person) => [person.id, person]));
  }

  function summary(workspace: Workspace, role: WorkspaceRole, memberCount: number, projectCount: number): WorkspaceSummary {
    return { ...workspace, role, member_count: memberCount, project_count: projectCount };
  }

  function invitationView(row: InvitationRow, inviter: WorkspacePerson | undefined): WorkspaceInvitation {
    return {
      id: row.id,
      invitee_email: row.invitee_email,
      inviter: inviter ?? null,
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
    };
  }

  function messageView(row: MessageRow, author: WorkspacePerson | undefined): WorkspaceMessage {
    return { id: row.id, workspace_id: row.workspace_id, message: row.message, user: author ?? null, created_at: row.created_at };
  }

  /**
   * Loads the `:id` workspace ahead of input validation: 404 when it does not
   * exist, 403 unless the caller belongs to it (or owns it, for `owner`).
   */
  const loaded = new WeakMap<Context, { workspace: Workspace; role: WorkspaceRole }>();
  const workspaceAccess =
    (need: 'member' | 'owner'): MiddlewareHandler =>
    async (context, next) => {
      const actor = guard.actor(context);
      const workspace = findWorkspace(context.req.param('id') ?? '');
      if (!workspace) return workspaceNotFound(context);
      const role = memberRole(workspace.id, actor.id);
      if (!role) return forbidden(context, 'You are not a member of this workspace');
      if (need === 'owner' && workspace.owner_id !== actor.id) return forbidden(context, 'Only the workspace owner can do this');
      loaded.set(context, { workspace, role });
      await next();
    };
  const current = (context: Context) => {
    const found = loaded.get(context);
    if (!found) throw new Error('Route reads the workspace without loading it');
    return found;
  };

  return new Hono()
    .get('/', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      const rows = listWorkspacesForUser(actor.id);
      const projectCounts = host.projectCounts(rows.map((row) => row.id));
      const workspaces = rows.map(({ role, member_count, ...workspace }) =>
        summary(workspace, role, member_count, projectCounts[workspace.id] ?? 0),
      );
      return context.json({ success: true as const, message: 'OK', data: { workspaces } } satisfies WorkspacesSuccess);
    })
    .post('/', guard.signedIn, jsonInput(createWorkspaceInputSchema), (context) => {
      const actor = guard.actor(context);
      const input = context.req.valid('json');
      const workspace = createWorkspace({ name: input.name, description: input.description ?? null, ownerId: actor.id });
      announceWorkspaceChange([actor.id]);
      return context.json(
        { success: true as const, message: 'Workspace created', data: { workspace } } satisfies WorkspaceSavedSuccess,
        201,
      );
    })
    .get('/:id', guard.signedIn, workspaceAccess('member'), (context) => {
      const { workspace, role } = current(context);
      const members = listMembers(workspace.id);
      const invitations = listPendingInvitations(workspace.id);
      const accounts = people([...members.map((member) => member.user_id), ...invitations.map((invitation) => invitation.inviter_id)]);
      const projectCount = host.projectCounts([workspace.id])[workspace.id] ?? 0;
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          workspace: summary(workspace, role, members.length, projectCount),
          // An account Auth no longer has is left out until its deletion reaches this Feature.
          members: members.flatMap((member) => {
            const user = accounts.get(member.user_id);
            return user ? [{ user, role: member.role, joined_at: member.created_at }] : [];
          }),
          invitations: invitations.map((invitation) => invitationView(invitation, accounts.get(invitation.inviter_id))),
        },
      } satisfies WorkspaceDetailSuccess);
    })
    .patch('/:id', guard.signedIn, workspaceAccess('owner'), jsonInput(updateWorkspaceInputSchema), (context) => {
      const { workspace } = current(context);
      const { revision, ...patch } = context.req.valid('json');
      const update = updateWorkspace(workspace.id, patch, revision);
      if (update.status === 'missing') return workspaceNotFound(context);
      if (update.status === 'stale') {
        return context.json(
          {
            success: false as const,
            message: 'This workspace changed elsewhere since you opened it',
            code: STALE_REVISION,
            current: update.workspace,
          },
          409,
        );
      }
      announceWorkspaceChange(memberIds(workspace.id));
      return context.json({
        success: true as const,
        message: 'Workspace updated',
        data: { workspace: update.workspace },
      } satisfies WorkspaceSavedSuccess);
    })
    .delete('/:id', guard.signedIn, workspaceAccess('owner'), (context) => {
      const { workspace } = current(context);
      const members = memberIds(workspace.id);
      getDatabase().transaction(() => {
        deleteWorkspace(workspace.id);
        host.workspaceDeleted(workspace.id);
      })();
      announceWorkspaceChange(members);
      return context.json({ success: true as const, message: 'Workspace deleted' } satisfies WorkspacesDone);
    })
    .post('/:id/invitations', guard.signedIn, workspaceAccess('member'), jsonInput(inviteMemberInputSchema), (context) => {
      const actor = guard.actor(context);
      const { workspace } = current(context);
      const { email } = context.req.valid('json');
      const invitee = host.findAccountByEmail(email);
      if (!invitee) return refuse(context, 404, 'ACCOUNT_NOT_FOUND', 'No account uses this email');
      if (memberRole(workspace.id, invitee.id)) return refuse(context, 409, 'ALREADY_MEMBER', 'This account is already a member of the workspace');
      const inviteeEmail = invitee.email.toLowerCase();
      if (hasOpenInvitation(workspace.id, inviteeEmail)) {
        return refuse(context, 409, 'INVITATION_PENDING', 'This email already has a pending invitation');
      }
      const invitation = createInvitation({ workspaceId: workspace.id, inviterId: actor.id, email: inviteeEmail });
      host.notify(invitee.id, WORKSPACE_NOTIFICATION_TYPES.invitation, {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        inviter_name: actor.name || actor.email,
        token: invitation.token,
      });
      announceWorkspaceChange([...memberIds(workspace.id), invitee.id]);
      return context.json(
        {
          success: true as const,
          message: 'Invitation sent',
          data: { invitation: invitationView(invitation, people([actor.id]).get(actor.id)) },
        } satisfies InvitationSentSuccess,
        201,
      );
    })
    .delete('/:id/invitations/:invitationId', guard.signedIn, workspaceAccess('owner'), (context) => {
      const { workspace } = current(context);
      const invitation = findInvitation(context.req.param('invitationId'));
      if (!invitation || invitation.workspace_id !== workspace.id) {
        return refuse(context, 404, 'INVITATION_NOT_FOUND', 'Invitation not found');
      }
      if (invitation.status !== 'pending') return refuse(context, 409, 'INVITATION_NOT_PENDING', 'This invitation was already answered');
      deleteInvitation(invitation.id);
      host.withdrawNotifications(WORKSPACE_NOTIFICATION_TYPES.invitation, 'token', invitation.token);
      const invitee = host.findAccountByEmail(invitation.invitee_email);
      announceWorkspaceChange([...memberIds(workspace.id), ...(invitee ? [invitee.id] : [])]);
      return context.json({ success: true as const, message: 'Invitation cancelled' } satisfies WorkspacesDone);
    })
    .delete('/:id/members/:userId', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      const workspace = findWorkspace(context.req.param('id'));
      if (!workspace) return workspaceNotFound(context);
      const targetId = context.req.param('userId');
      const isOwner = workspace.owner_id === actor.id;
      if (!isOwner && targetId !== actor.id) return forbidden(context, 'Only the workspace owner can remove other members');
      if (targetId === workspace.owner_id) {
        return refuse(context, 409, 'OWNER_CANNOT_LEAVE', 'The owner cannot leave or be removed from the workspace');
      }
      const members = memberIds(workspace.id);
      if (!removeMember(workspace.id, targetId)) return refuse(context, 404, 'MEMBER_NOT_FOUND', 'This account is not a member of the workspace');
      announceWorkspaceChange(members);
      return context.json({
        success: true as const,
        message: targetId === actor.id ? 'You left the workspace' : 'Member removed',
      } satisfies WorkspacesDone);
    })
    .get('/:id/messages', guard.signedIn, workspaceAccess('member'), (context) => {
      const { workspace } = current(context);
      const rows = listMessages(workspace.id);
      const authors = people(rows.map((row) => row.user_id));
      return context.json({
        success: true as const,
        message: 'OK',
        data: { messages: rows.map((row) => messageView(row, authors.get(row.user_id))) },
      } satisfies WorkspaceMessagesSuccess);
    })
    .post('/:id/messages', guard.signedIn, workspaceAccess('member'), jsonInput(postMessageInputSchema), (context) => {
      const actor = guard.actor(context);
      const { workspace } = current(context);
      const row = insertMessage({ workspaceId: workspace.id, userId: actor.id, message: context.req.valid('json').message });
      announceChatMessage(memberIds(workspace.id));
      return context.json(
        {
          success: true as const,
          message: 'Message sent',
          data: { message: messageView(row, people([actor.id]).get(actor.id)) },
        } satisfies MessagePostedSuccess,
        201,
      );
    });
}

/** Invitations as their invitee sees them, mounted apart from the workspaces they lead to. */
export function createInvitationRoutes(host: WorkspacesServerHost) {
  const guard = createGuard((context) => host.resolveActor(getCookie(context, host.sessionCookieName)));

  return new Hono()
    .get('/', guard.signedIn, (context) => {
      const actor = guard.actor(context);
      const rows = listReceivedInvitations(actor.email.toLowerCase());
      const inviters = new Map(host.findAccountsByIds(rows.map((row) => row.inviter_id)).map((person) => [person.id, person]));
      return context.json({
        success: true as const,
        message: 'OK',
        data: {
          invitations: rows.map((row) => ({
            id: row.id,
            token: row.token,
            workspace: { id: row.workspace_id, name: row.workspace_name },
            inviter: inviters.get(row.inviter_id) ?? null,
            expires_at: row.expires_at,
            created_at: row.created_at,
          })),
        },
      } satisfies ReceivedInvitationsSuccess);
    })
    .post('/:token/respond', guard.signedIn, jsonInput(respondInvitationInputSchema), (context) => {
      const actor = guard.actor(context);
      const { action } = context.req.valid('json');
      const invitation = findInvitationByToken(context.req.param('token'));
      if (!invitation) return refuse(context, 404, 'INVITATION_NOT_FOUND', 'Invitation not found');
      if (invitation.invitee_email.toLowerCase() !== actor.email.toLowerCase()) {
        return forbidden(context, 'This invitation is for another account');
      }
      if (invitation.status !== 'pending') return refuse(context, 409, 'INVITATION_NOT_PENDING', 'This invitation was already answered');
      if (invitation.expires_at <= Date.now()) return refuse(context, 409, 'INVITATION_EXPIRED', 'This invitation has expired');
      const workspace = findWorkspace(invitation.workspace_id);
      if (!workspace) return refuse(context, 404, 'INVITATION_NOT_FOUND', 'Invitation not found');

      const status = action === 'accept' ? 'accepted' : 'declined';
      getDatabase().transaction(() => {
        setInvitationStatus(invitation.id, status);
        if (status === 'accepted') addMember(workspace.id, actor.id, 'member');
      })();
      host.withdrawNotifications(WORKSPACE_NOTIFICATION_TYPES.invitation, 'token', invitation.token);
      if (status === 'accepted') {
        host.notify(invitation.inviter_id, WORKSPACE_NOTIFICATION_TYPES.invitationAccepted, {
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          accepter_name: actor.name || actor.email,
        });
      }
      announceWorkspaceChange([...memberIds(workspace.id), actor.id]);
      return context.json({
        success: true as const,
        message: status === 'accepted' ? 'You joined the workspace' : 'Invitation declined',
        data: { workspace_id: workspace.id, status },
      } satisfies InvitationAnsweredSuccess);
    });
}

