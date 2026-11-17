import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../../app/server';
import { signUp } from '../../../../app/tests/personas';
import { webCsrf } from '../../../../app/tests/web-csrf';
import { installBrowser, type TestBrowser } from '../../../../shared/security/tests/browser';
import { workspacesResponseSchemas } from '../../contract';
import { createWorkspacesClient } from '../../web';
import { createInvitation } from '../../server/repository';

const schemas = workspacesResponseSchemas();

describe('workspaces web client contract', () => {
  let browser: TestBrowser;
  const client = createWorkspacesClient({ csrf: webCsrf });

  beforeEach(() => {
    browser = installBrowser(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers every method in the declared success shape', async () => {
    const owner = await browser.signUp();
    const invitee = await signUp('Contract Invitee');

    const created = schemas.workspaceSaved.parse(await client.create({ name: 'Contract Space', description: 'About' }));
    const id = created.data.workspace.id;
    schemas.workspaces.parse(await client.list());
    const updated = schemas.workspaceSaved.parse(await client.update(id, { revision: 1, name: 'Contract Renamed' }));
    expect(updated.data.workspace.revision).toBe(2);

    const invited = schemas.invitationSent.parse(await client.invite(id, { email: invitee.email }));
    const detail = schemas.workspaceDetail.parse(await client.get(id));
    expect(detail.data.invitations.map((invitation) => invitation.id)).toEqual([invited.data.invitation.id]);
    schemas.done.parse(await client.cancelInvitation(id, invited.data.invitation.id));

    schemas.messagePosted.parse(await client.postMessage(id, { message: 'Hello' }));
    expect(schemas.messages.parse(await client.messages(id)).data.messages).toHaveLength(1);

    // An invitation to the signed-in account, from a workspace it does not belong to yet.
    const other = schemas.workspaceSaved.parse(await client.create({ name: 'Other Space' })).data.workspace;
    const received = createInvitation({ workspaceId: other.id, inviterId: invitee.id, email: owner.email });
    expect(schemas.receivedInvitations.parse(await client.receivedInvitations()).data.invitations[0].token).toBe(received.token);
    schemas.invitationAnswered.parse(await client.respondInvitation(received.token, { action: 'decline' }));

    schemas.done.parse(await client.remove(id));
  });

  it('answers refusals in the declared error shapes', async () => {
    expect(schemas.error.parse(await client.list())).toMatchObject({ code: 'UNAUTHORIZED' });
    await browser.signUp();
    expect(schemas.error.parse(await client.get(randomUUID()))).toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    const id = schemas.workspaceSaved.parse(await client.create({ name: 'Refusals' })).data.workspace.id;
    await client.update(id, { revision: 1, name: 'Moved on' });
    expect(schemas.staleWorkspace.parse(await client.update(id, { revision: 1, name: 'Stale' })).current.revision).toBe(2);
    expect(schemas.error.parse(await client.invite(id, { email: `${randomUUID()}@example.com` }))).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    expect(schemas.error.parse(await client.postMessage(id, { message: '' }))).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(schemas.error.parse(await client.respondInvitation(randomUUID(), { action: 'accept' }))).toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    });
  });
});
