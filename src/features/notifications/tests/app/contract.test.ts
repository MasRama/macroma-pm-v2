import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../../app/server';
import { webCsrf } from '../../../../app/tests/web-csrf';
import { installBrowser, type TestBrowser } from '../../../../shared/security/tests/browser';
import { notificationsResponseSchemas } from '../../contract';
import { notify } from '../../index';
import { createNotificationsClient } from '../../web';

const schemas = notificationsResponseSchemas();

describe('notifications web client contract', () => {
  let browser: TestBrowser;
  const client = createNotificationsClient({ csrf: webCsrf });

  beforeEach(() => {
    browser = installBrowser(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers every method in the declared success shape', async () => {
    const { id } = await browser.signUp();
    const first = notify(id, 'workspace_invitation', { workspace_name: 'Alpha', token: 't', count: 2, flag: true, empty: null });
    notify(id, 'invitation_accepted', { workspace_name: 'Alpha' });

    const listed = schemas.listSuccess.parse(await client.list());
    expect(listed.data.unread_count).toBe(2);
    expect(schemas.markSuccess.parse(await client.markRead(first.id)).success).toBe(true);
    expect(schemas.markSuccess.parse(await client.markAllRead()).success).toBe(true);
    expect(schemas.listSuccess.parse(await client.list()).data.unread_count).toBe(0);
  });

  it('answers refusals in the declared error shape', async () => {
    expect(schemas.error.parse(await client.list())).toMatchObject({ code: 'UNAUTHORIZED' });
    await browser.signUp();
    expect(schemas.error.parse(await client.markRead(randomUUID()))).toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
  });
});
