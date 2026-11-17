import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetSecurityState } from '../../../../app/server';
import { callApi } from '../../../../app/tests/api';
import { grantAdmin, signUp, type Persona } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { WORKSPACE_CHAT_LIMIT } from '../../contract';
import { insertMessage } from '../../server/repository';

async function createWorkspace(owner: Persona, name = 'Alpha') {
  const created = await callApi(owner, 'POST', '/api/workspaces', { name, description: 'First workspace' });
  expect(created.status).toBe(201);
  return created.body.data.workspace as { id: string; revision: number; name: string };
}

async function inviteAndAccept(owner: Persona, workspaceId: string, invitee: Persona): Promise<void> {
  const invited = await callApi(owner, 'POST', `/api/workspaces/${workspaceId}/invitations`, { email: invitee.email });
  expect(invited.status).toBe(201);
  const token = getDatabase().prepare('SELECT token FROM workspace_invitations WHERE id = ?').get(invited.body.data.invitation.id) as {
    token: string;
  };
  expect((await callApi(invitee, 'POST', `/api/invitations/${token.token}/respond`, { action: 'accept' })).status).toBe(200);
}

async function notificationsOf(persona: Persona) {
  return (await callApi(persona, 'GET', '/api/notifications')).body.data.notifications as Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
}

describe('workspaces', () => {
  // Registration shares the strict per-client limit; each case starts afresh.
  beforeEach(() => resetSecurityState());

  it('creates a workspace owned by its creator and shows it only to members', async () => {
    const owner = await signUp('Workspace Owner');
    const outsider = await signUp('Workspace Outsider');
    const workspace = await createWorkspace(owner);

    const listed = await callApi(owner, 'GET', '/api/workspaces');
    expect(listed.body.data.workspaces).toEqual([
      expect.objectContaining({ id: workspace.id, role: 'owner', member_count: 1, project_count: 0, revision: 1 }),
    ]);
    expect((await callApi(outsider, 'GET', '/api/workspaces')).body.data.workspaces).toEqual([]);

    const shown = await callApi(owner, 'GET', `/api/workspaces/${workspace.id}`);
    expect(shown.body.data.members).toEqual([
      { user: { id: owner.id, name: owner.name, email: owner.email, avatar: null }, role: 'owner', joined_at: expect.any(Number) },
    ]);
    expect((await callApi(outsider, 'GET', `/api/workspaces/${workspace.id}`)).status).toBe(403);
    const missing = await callApi(owner, 'GET', `/api/workspaces/${randomUUID()}`);
    expect(missing).toMatchObject({ status: 404, body: { code: 'WORKSPACE_NOT_FOUND' } });
    expect((await callApi(undefined, 'GET', '/api/workspaces')).status).toBe(401);
    expect((await callApi(owner, 'POST', '/api/workspaces', { name: '  ' })).status).toBe(422);
  });

  it('lets only the owner edit, and refuses an edit based on an older revision', async () => {
    const owner = await signUp('Editing Owner');
    const member = await signUp('Editing Member');
    const workspace = await createWorkspace(owner);
    await inviteAndAccept(owner, workspace.id, member);

    expect((await callApi(member, 'PATCH', `/api/workspaces/${workspace.id}`, { revision: 1, name: 'Hijack' })).status).toBe(403);
    const saved = await callApi(owner, 'PATCH', `/api/workspaces/${workspace.id}`, { revision: 1, name: 'Renamed', description: '' });
    expect(saved.body.data.workspace).toMatchObject({ name: 'Renamed', description: null, revision: 2 });

    const stale = await callApi(owner, 'PATCH', `/api/workspaces/${workspace.id}`, { revision: 1, name: 'Stale' });
    expect(stale).toMatchObject({ status: 409, body: { code: 'STALE_REVISION', current: { name: 'Renamed', revision: 2 } } });
    expect((await callApi(owner, 'PATCH', `/api/workspaces/${workspace.id}`, { revision: 2 })).status).toBe(422);
  });

  it('invites an existing account, notifies it, and joins it on accept', async () => {
    const owner = await signUp('Inviting Owner');
    const invitee = await signUp('Invitee');
    const stranger = await signUp('Invitation Stranger');
    const workspace = await createWorkspace(owner, 'Invite Space');
    const path = `/api/workspaces/${workspace.id}/invitations`;

    expect(await callApi(owner, 'POST', path, { email: `${randomUUID()}@example.com` })).toMatchObject({
      status: 404,
      body: { code: 'ACCOUNT_NOT_FOUND' },
    });
    expect(await callApi(owner, 'POST', path, { email: owner.email })).toMatchObject({ status: 409, body: { code: 'ALREADY_MEMBER' } });
    expect((await callApi(stranger, 'POST', path, { email: invitee.email })).status).toBe(403);

    const invited = await callApi(owner, 'POST', path, { email: invitee.email.toUpperCase() });
    expect(invited.status).toBe(201);
    expect(invited.body.data.invitation).toMatchObject({ invitee_email: invitee.email, status: 'pending', inviter: { id: owner.id } });
    expect(await callApi(owner, 'POST', path, { email: invitee.email })).toMatchObject({ status: 409, body: { code: 'INVITATION_PENDING' } });

    const notice = (await notificationsOf(invitee)).find((notification) => notification.type === 'workspace_invitation');
    expect(notice?.data).toMatchObject({ workspace_id: workspace.id, workspace_name: 'Invite Space', inviter_name: owner.name });
    const token = notice?.data.token as string;

    const received = await callApi(invitee, 'GET', '/api/invitations');
    expect(received.body.data.invitations).toEqual([
      expect.objectContaining({ token, workspace: { id: workspace.id, name: 'Invite Space' }, inviter: expect.objectContaining({ id: owner.id }) }),
    ]);
    expect((await callApi(stranger, 'POST', `/api/invitations/${token}/respond`, { action: 'accept' })).status).toBe(403);
    expect((await callApi(invitee, 'POST', `/api/invitations/${token}/respond`, { action: 'maybe' })).status).toBe(422);

    const accepted = await callApi(invitee, 'POST', `/api/invitations/${token}/respond`, { action: 'accept' });
    expect(accepted).toMatchObject({ status: 200, body: { data: { workspace_id: workspace.id, status: 'accepted' } } });
    expect((await callApi(invitee, 'GET', `/api/workspaces/${workspace.id}`)).status).toBe(200);
    expect((await notificationsOf(invitee)).some((notification) => notification.type === 'workspace_invitation')).toBe(false);
    expect((await notificationsOf(owner)).find((notification) => notification.type === 'invitation_accepted')?.data).toMatchObject({
      workspace_id: workspace.id,
      accepter_name: invitee.name,
    });
    expect(await callApi(invitee, 'POST', `/api/invitations/${token}/respond`, { action: 'decline' })).toMatchObject({
      status: 409,
      body: { code: 'INVITATION_NOT_PENDING' },
    });
    expect(await callApi(invitee, 'POST', `/api/invitations/${randomUUID()}/respond`, { action: 'accept' })).toMatchObject({
      status: 404,
      body: { code: 'INVITATION_NOT_FOUND' },
    });
  });

  it('declines, refuses an expired invitation, and lets a new one replace it', async () => {
    const owner = await signUp('Expiry Owner');
    const invitee = await signUp('Expiry Invitee');
    const workspace = await createWorkspace(owner);
    const path = `/api/workspaces/${workspace.id}/invitations`;

    const first = await callApi(owner, 'POST', path, { email: invitee.email });
    const firstToken = (getDatabase().prepare('SELECT token FROM workspace_invitations WHERE id = ?').get(first.body.data.invitation.id) as { token: string }).token;
    expect((await callApi(invitee, 'POST', `/api/invitations/${firstToken}/respond`, { action: 'decline' })).body.data.status).toBe('declined');
    expect((await callApi(invitee, 'GET', `/api/workspaces/${workspace.id}`)).status).toBe(403);

    const second = await callApi(owner, 'POST', path, { email: invitee.email });
    const secondId = second.body.data.invitation.id as string;
    getDatabase().prepare('UPDATE workspace_invitations SET expires_at = ? WHERE id = ?').run(Date.now() - 1, secondId);
    const secondToken = (getDatabase().prepare('SELECT token FROM workspace_invitations WHERE id = ?').get(secondId) as { token: string }).token;
    expect(await callApi(invitee, 'POST', `/api/invitations/${secondToken}/respond`, { action: 'accept' })).toMatchObject({
      status: 409,
      body: { code: 'INVITATION_EXPIRED' },
    });
    expect((await callApi(invitee, 'GET', '/api/invitations')).body.data.invitations).toEqual([]);

    expect((await callApi(owner, 'POST', path, { email: invitee.email })).status).toBe(201);
    expect(getDatabase().prepare('SELECT 1 FROM workspace_invitations WHERE id = ?').get(secondId)).toBeUndefined();
  });

  it('lets only the owner cancel a pending invitation, and withdraws its notice', async () => {
    const owner = await signUp('Cancel Owner');
    const member = await signUp('Cancel Member');
    const invitee = await signUp('Cancel Invitee');
    const workspace = await createWorkspace(owner);
    await inviteAndAccept(owner, workspace.id, member);

    const invited = await callApi(member, 'POST', `/api/workspaces/${workspace.id}/invitations`, { email: invitee.email });
    expect(invited.status).toBe(201);
    const invitationPath = `/api/workspaces/${workspace.id}/invitations/${invited.body.data.invitation.id}`;
    expect((await callApi(owner, 'GET', `/api/workspaces/${workspace.id}`)).body.data.invitations).toHaveLength(1);

    expect((await callApi(member, 'DELETE', invitationPath)).status).toBe(403);
    expect(await callApi(owner, 'DELETE', `/api/workspaces/${workspace.id}/invitations/${randomUUID()}`)).toMatchObject({
      status: 404,
      body: { code: 'INVITATION_NOT_FOUND' },
    });
    expect((await callApi(owner, 'DELETE', invitationPath)).status).toBe(200);
    expect((await notificationsOf(invitee)).some((notification) => notification.type === 'workspace_invitation')).toBe(false);
    expect((await callApi(owner, 'GET', `/api/workspaces/${workspace.id}`)).body.data.invitations).toEqual([]);
  });

  it('lets members leave and the owner remove them, but never the owner', async () => {
    const owner = await signUp('Members Owner');
    const first = await signUp('First Member');
    const second = await signUp('Second Member');
    const workspace = await createWorkspace(owner);
    await inviteAndAccept(owner, workspace.id, first);
    await inviteAndAccept(owner, workspace.id, second);
    const members = (userId: string) => `/api/workspaces/${workspace.id}/members/${userId}`;

    expect((await callApi(first, 'DELETE', members(second.id))).status).toBe(403);
    expect(await callApi(owner, 'DELETE', members(owner.id))).toMatchObject({ status: 409, body: { code: 'OWNER_CANNOT_LEAVE' } });
    expect((await callApi(first, 'DELETE', members(first.id))).body.message).toBe('You left the workspace');
    expect((await callApi(owner, 'DELETE', members(second.id))).body.message).toBe('Member removed');
    expect(await callApi(owner, 'DELETE', members(second.id))).toMatchObject({ status: 404, body: { code: 'MEMBER_NOT_FOUND' } });
    expect((await callApi(owner, 'GET', `/api/workspaces/${workspace.id}`)).body.data.workspace.member_count).toBe(1);
  });

  it('keeps a chat for members: the latest messages, oldest first, with their authors', async () => {
    const owner = await signUp('Chat Owner');
    const outsider = await signUp('Chat Outsider');
    const workspace = await createWorkspace(owner);
    const path = `/api/workspaces/${workspace.id}/messages`;

    for (let index = 0; index < WORKSPACE_CHAT_LIMIT + 2; index += 1) {
      insertMessage({ workspaceId: workspace.id, userId: owner.id, message: `old ${index}` });
    }
    const posted = await callApi(owner, 'POST', path, { message: '  Hello team  ' });
    expect(posted).toMatchObject({ status: 201, body: { data: { message: { message: 'Hello team', user: { id: owner.id } } } } });
    expect((await callApi(owner, 'POST', path, { message: '   ' })).status).toBe(422);
    expect((await callApi(owner, 'POST', path, { message: 'x'.repeat(2001) })).status).toBe(422);
    expect((await callApi(outsider, 'POST', path, { message: 'Hi' })).status).toBe(403);
    expect((await callApi(outsider, 'GET', path)).status).toBe(403);

    const listed = (await callApi(owner, 'GET', path)).body.data.messages as Array<{ message: string }>;
    expect(listed).toHaveLength(WORKSPACE_CHAT_LIMIT);
    expect(listed.at(-1)?.message).toBe('Hello team');
    expect(listed[0].message).toBe('old 3');
  });

  it('deletes a workspace for its owner only', async () => {
    const owner = await signUp('Deleting Owner');
    const member = await signUp('Deleting Member');
    const workspace = await createWorkspace(owner);
    await inviteAndAccept(owner, workspace.id, member);

    expect((await callApi(member, 'DELETE', `/api/workspaces/${workspace.id}`)).status).toBe(403);
    expect((await callApi(owner, 'DELETE', `/api/workspaces/${workspace.id}`)).status).toBe(200);
    expect((await callApi(owner, 'GET', `/api/workspaces/${workspace.id}`)).status).toBe(404);
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?').get(workspace.id)).toEqual({
      count: 0,
    });
  });

  it('forgets deleted accounts: their workspaces, memberships and messages', async () => {
    const admin = await signUp('Workspace Admin');
    grantAdmin(admin.id);
    const owner = await signUp('Doomed Owner');
    const member = await signUp('Doomed Member');
    const survivor = await signUp('Surviving Owner');
    const owned = await createWorkspace(owner, 'Owned');
    const kept = await createWorkspace(survivor, 'Kept');
    await inviteAndAccept(survivor, kept.id, member);
    await callApi(member, 'POST', `/api/workspaces/${kept.id}/messages`, { message: 'bye' });

    expect((await callApi(admin, 'DELETE', '/api/users', { ids: [owner.id, member.id] })).status).toBe(200);
    expect(getDatabase().prepare('SELECT 1 FROM workspaces WHERE id = ?').get(owned.id)).toBeUndefined();
    const shown = await callApi(survivor, 'GET', `/api/workspaces/${kept.id}`);
    expect(shown.body.data.members.map((entry: { user: { id: string } }) => entry.user.id)).toEqual([survivor.id]);
    expect((await callApi(survivor, 'GET', `/api/workspaces/${kept.id}/messages`)).body.data.messages).toEqual([]);
  });
});
