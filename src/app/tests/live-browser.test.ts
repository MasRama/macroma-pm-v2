/// <reference lib="dom" />
import { randomUUID } from 'node:crypto';
import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import router from '../router';
import { app as serverApp } from '../server';
import { useAuthSession } from '../../features/auth/web';
import { getDatabase, seed } from '../../shared/database';
import { closeEventStreams } from '../../shared/realtime';
import { readEvents, type EventReader } from '../../shared/realtime/tests/helpers';
import { csrfHeaders, issueCsrf, mergeResponseCookies } from '../../shared/security/tests/helpers';
import { grantRole } from './personas';

/**
 * The open tab follows the server: the real application streams events and a
 * stand-in EventSource delivers them to the mounted app, as a browser would.
 */
const PASSWORD = 'correct horse battery staple';

let container: HTMLDivElement;
let application: { unmount(): void } | undefined;
/** The tab's cookies; other devices keep their own. */
let tabCookie = '';
let pending: Set<Promise<unknown>>;

function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.finally(() => pending.delete(promise)).catch(() => undefined);
  return promise;
}

class StreamedEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = StreamedEventSource.CONNECTING;
  private events: EventReader | undefined;

  constructor(url: string) {
    super();
    void track(this.open(url));
  }

  private async open(url: string): Promise<void> {
    const response = await serverApp.request(url, { headers: { Cookie: tabCookie } });
    if (this.readyState === StreamedEventSource.CLOSED) return;
    if (response.status !== 200) {
      this.readyState = StreamedEventSource.CLOSED;
      this.dispatchEvent(new Event('error'));
      return;
    }
    this.readyState = StreamedEventSource.OPEN;
    this.events = readEvents(response);
    void this.pump();
  }

  private async pump(): Promise<void> {
    for (;;) {
      const event = await this.events!.next(60_000);
      if (this.readyState === StreamedEventSource.CLOSED) return;
      if (event === 'closed') {
        this.readyState = StreamedEventSource.CONNECTING;
        this.dispatchEvent(new Event('error'));
        return;
      }
      if (event !== 'timeout') await track(Promise.resolve(this.dispatchEvent(new Event(event))));
    }
  }

  close(): void {
    this.readyState = StreamedEventSource.CLOSED;
    void this.events?.cancel();
  }
}

function installTabFetch(): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    track(
      (async () => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://nara.test');
        const headers = new Headers(init?.headers);
        if (tabCookie) headers.set('Cookie', tabCookie);
        const response = await serverApp.request(url.pathname + url.search, { method: init?.method ?? 'GET', headers, body: init?.body });
        tabCookie = mergeResponseCookies(tabCookie, response);
        for (const pair of tabCookie.split('; ')) if (pair.startsWith('csrf_token=')) document.cookie = pair;
        return response;
      })(),
    ),
  );
}

/** Sends a request as another device holding `cookie`; returns the updated cookie. */
async function asDevice(cookie: string, path: string, method: string, body?: unknown): Promise<{ status: number; cookie: string }> {
  const state = await issueCsrf(serverApp, cookie || undefined);
  const response = await serverApp.request(path, {
    method,
    headers: csrfHeaders(state, { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, cookie: mergeResponseCookies(state.cookie, response) };
}

async function register(name = 'Live Browser'): Promise<{ id: string; email: string; cookie: string }> {
  const email = `${randomUUID()}@example.com`;
  const { status, cookie } = await asDevice('', '/api/auth/register', 'POST', { name, email, password: PASSWORD });
  expect(status).toBe(201);
  const row = getDatabase().prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string };
  return { id: row.id, email, cookie };
}

/** Opens the app in this tab as the account behind `cookie`. */
async function openTab(cookie: string, path: string): Promise<void> {
  tabCookie = cookie;
  await useAuthSession().refresh();
  await router.push(path);
  await router.isReady();
  const mounted = createApp(App).use(router);
  mounted.mount(container);
  application = mounted;
  await settle();
}

/** Types into a form field the way a person would. */
function type(selector: string, value: string): void {
  const field = container.querySelector<HTMLInputElement>(selector);
  expect(field).not.toBeNull();
  field!.value = value;
  field!.dispatchEvent(new Event('input'));
}

function fieldValue(selector: string): string | undefined {
  return container.querySelector<HTMLInputElement>(selector)?.value;
}

async function click(selector: string): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  button!.click();
  await settle();
}

async function settle(): Promise<void> {
  for (let round = 0; round < 12; round += 1) {
    if (pending.size > 0) await Promise.allSettled([...pending]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nextTick();
  }
}

beforeEach(async () => {
  seed();
  container = document.createElement('div');
  document.body.append(container);
  application = undefined;
  tabCookie = '';
  pending = new Set();
  installTabFetch();
  vi.stubGlobal('EventSource', StreamedEventSource);
  await useAuthSession().refresh();
  await router.push('/');
  await router.isReady();
});

afterEach(async () => {
  application?.unmount();
  closeEventStreams();
  await settle();
  container.remove();
  tabCookie = '';
  await useAuthSession().refresh();
  vi.unstubAllGlobals();
});

describe('live updates in the open tab', () => {
  it('sends the tab to sign in, saying why, when another device ends its session', async () => {
    const account = await register();
    await openTab(account.cookie, '/security');
    expect(router.currentRoute.value.name).toBe('security');

    const phone = await asDevice('', '/api/auth/login', 'POST', { email: account.email, password: PASSWORD });
    expect((await asDevice(phone.cookie, '/api/auth/sessions/revoke-others', 'POST')).status).toBe(200);
    await settle();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query).toMatchObject({ redirect: '/security', reason: 'session-ended' });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Sesi kamu sudah berakhir');
  });

  it('leaves a page as soon as an administrator takes away the permission it needs', async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const member = await register();
    const slug = `live-${randomUUID().slice(0, 8)}`;
    expect(
      (await asDevice(admin.cookie, '/api/roles', 'POST', { name: 'Live Readers', slug, permissions: ['activity.view'] })).status,
    ).toBe(201);
    grantRole(member.id, slug);

    await openTab(member.cookie, '/activity');
    expect(router.currentRoute.value.name).toBe('activity');

    const role = getDatabase().prepare('SELECT id FROM roles WHERE slug = ?').get(slug) as { id: string };
    expect((await asDevice(admin.cookie, `/api/roles/${role.id}`, 'PUT', { revision: 1, permissions: [] })).status).toBe(200);
    await settle();

    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(useAuthSession().can('activity.view')).toBe(false);
  });

  it('shows new activity on the first page without a reload', async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const member = await register();
    await openTab(admin.cookie, '/activity');
    const newest = () => container.querySelector('.act-event')?.textContent ?? '';
    expect(newest()).toContain('Account registered');

    expect((await asDevice('', '/api/auth/login', 'POST', { email: member.email, password: PASSWORD })).status).toBe(200);
    await settle();

    expect(newest()).toContain('Signed in');
    expect(newest()).toContain(member.id);
  });

  it('lists a device as it signs in and drops it as it signs out', async () => {
    const account = await register();
    await openTab(account.cookie, '/security');
    const devices = () => container.querySelectorAll('[data-testid="session-row"]').length;
    expect(devices()).toBe(1);

    const phone = await asDevice('', '/api/auth/login', 'POST', { email: account.email, password: PASSWORD });
    await settle();
    expect(devices()).toBe(2);

    expect((await asDevice(phone.cookie, '/api/auth/logout', 'POST')).status).toBe(200);
    await settle();
    expect(devices()).toBe(1);
    expect(router.currentRoute.value.name).toBe('security');
  });

  it("shows another administrator's new role without a reload", async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const colleague = await register();
    grantRole(colleague.id, 'admin');
    await openTab(admin.cookie, '/roles');
    const slug = `live-${randomUUID().slice(0, 8)}`;
    expect(container.querySelector('[data-testid="role-list"]')?.textContent).not.toContain(slug);

    expect((await asDevice(colleague.cookie, '/api/roles', 'POST', { name: 'Live Editors', slug, permissions: [] })).status).toBe(201);
    await settle();

    expect(container.querySelector('[data-testid="role-list"]')?.textContent).toContain(slug);
  });

  it("merges another administrator's save into an open role form and asks only about the field both changed", async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const colleague = await register();
    grantRole(colleague.id, 'admin');
    const slug = `live-${randomUUID().slice(0, 8)}`;
    expect((await asDevice(colleague.cookie, '/api/roles', 'POST', { name: 'Live Editors', slug, permissions: [] })).status).toBe(201);
    const role = getDatabase().prepare('SELECT id FROM roles WHERE slug = ?').get(slug) as { id: string };

    await openTab(admin.cookie, '/roles');
    await click(`[data-testid="edit-role-${role.id}"]`);
    type('#role-name', 'Mine');
    await settle();

    const theirSlug = `${slug}-theirs`;
    expect((await asDevice(colleague.cookie, `/api/roles/${role.id}`, 'PUT', { revision: 1, name: 'Theirs', slug: theirSlug })).status).toBe(200);
    await settle();

    // The slug only they changed follows their save; the name both changed waits for a choice.
    expect(fieldValue('#role-slug')).toBe(theirSlug);
    expect(fieldValue('#role-name')).toBe('Mine');
    expect(container.querySelector('[data-testid="role-merge-notice"]')?.textContent).toContain('Slug');
    const conflicts = [...container.querySelectorAll('[data-testid="role-conflicts"] [data-conflict-field]')].map((row) => row.getAttribute('data-conflict-field'));
    expect(conflicts).toEqual(['name']);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="role-form"] button[type="submit"]')?.disabled).toBe(true);

    await click('[data-testid="keep-mine-name"]');
    expect(container.querySelector('[data-testid="role-conflicts"]')).toBeNull();
    container.querySelector<HTMLFormElement>('[data-testid="role-form"]')!.requestSubmit();
    await settle();

    expect(getDatabase().prepare('SELECT name, slug, revision FROM roles WHERE id = ?').get(role.id)).toEqual({ name: 'Mine', slug: theirSlug, revision: 3 });
    expect(container.querySelector('[data-testid="role-form"]')).toBeNull();
  });

  it('shows who else has the same role open, and drops them when they close it', async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const colleague = await register('Grace Colleague');
    grantRole(colleague.id, 'admin');
    const slug = `live-${randomUUID().slice(0, 8)}`;
    expect((await asDevice(colleague.cookie, '/api/roles', 'POST', { name: 'Live Editors', slug, permissions: [] })).status).toBe(201);
    const role = getDatabase().prepare('SELECT id FROM roles WHERE slug = ?').get(slug) as { id: string };

    await openTab(admin.cookie, '/roles');
    await click(`[data-testid="edit-role-${role.id}"]`);
    // The tab's own presence is not news to it.
    expect(container.querySelector('[data-testid="role-editors"]')).toBeNull();

    expect((await asDevice(colleague.cookie, `/api/roles/${role.id}/editing`, 'PUT')).status).toBe(200);
    await settle();
    expect(container.querySelector('[data-testid="role-editors"]')?.textContent).toContain('Grace Colleague is also editing this role');
    expect(container.querySelector('[data-testid="role-editing"]')?.textContent).toContain('Grace Colleague');

    expect((await asDevice(colleague.cookie, `/api/roles/${role.id}/editing`, 'DELETE')).status).toBe(200);
    await settle();
    expect(container.querySelector('[data-testid="role-editors"]')).toBeNull();
  });

  it("follows an administrator's change to the open profile, keeping what the account is typing", async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const member = await register();

    await openTab(member.cookie, '/profile');
    expect(fieldValue('#profile-name')).toBe('Live Browser');
    const renamed = `${randomUUID()}@example.com`;
    expect((await asDevice(admin.cookie, `/api/users/${member.id}`, 'PUT', { revision: 1, email: renamed })).status).toBe(200);
    await settle();
    expect(fieldValue('#profile-email')).toBe(renamed);

    type('#profile-name', 'Typed Here');
    await settle();
    expect((await asDevice(admin.cookie, `/api/users/${member.id}`, 'PUT', { revision: 2, name: 'Admin Pick' })).status).toBe(200);
    await settle();

    expect(fieldValue('#profile-name')).toBe('Typed Here');
    expect(container.querySelector('[data-testid="profile-conflicts"] [data-conflict-field="name"]')).not.toBeNull();
    await click('[data-testid="use-theirs-name"]');
    expect(fieldValue('#profile-name')).toBe('Admin Pick');
    expect(container.querySelector('[data-testid="profile-conflicts"]')).toBeNull();
  });
});

describe('the notification bell in the open tab', () => {
  /** Creates a workspace as `owner` and invites `invitee`; returns the workspace id. */
  async function invite(owner: { cookie: string }, invitee: { email: string }, name = 'Nara Labs'): Promise<string> {
    expect((await asDevice(owner.cookie, '/api/workspaces', 'POST', { name })).status).toBe(201);
    const workspace = getDatabase().prepare('SELECT id FROM workspaces WHERE name = ? ORDER BY created_at DESC LIMIT 1').get(name) as { id: string };
    expect((await asDevice(owner.cookie, `/api/workspaces/${workspace.id}/invitations`, 'POST', { email: invitee.email })).status).toBe(201);
    return workspace.id;
  }

  const dot = () => container.querySelector('[data-testid="notifications-dot"]');
  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="notifications-menu"] [data-notification-id]')];
  const isMember = (workspaceId: string, userId: string) =>
    getDatabase().prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) !== undefined;

  it('shows an invitation as it arrives and joins the workspace on Terima', async () => {
    const owner = await register('Dimas Owner');
    const invitee = await register('Ayu Invitee');
    await openTab(invitee.cookie, '/profile');
    expect(dot()).toBeNull();

    const workspaceId = await invite(owner, invitee);
    await settle();
    expect(dot()).not.toBeNull();
    expect(container.querySelector('[data-testid="notifications-bell"]')?.getAttribute('aria-label')).toBe('Notifikasi, 1 belum dibaca');

    await click('[data-testid="notifications-bell"]');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Dimas Owner ngundang kamu ke workspace Nara Labs');

    await click('[data-testid="invite-accept"]');
    expect(isMember(workspaceId, invitee.id)).toBe(true);
    // Answered invitations are withdrawn; the inviter hears about it instead.
    expect(rows()).toHaveLength(0);
    expect(dot()).toBeNull();
    const told = getDatabase().prepare("SELECT data_json FROM notifications WHERE user_id = ? AND type = 'invitation_accepted'").get(owner.id) as
      | { data_json: string }
      | undefined;
    expect(JSON.parse(told!.data_json)).toMatchObject({ workspace_name: 'Nara Labs', accepter_name: 'Ayu Invitee' });
  });

  it('declines on Tolak, and says by code why an expired invitation cannot be answered', async () => {
    const owner = await register('Dimas Owner');
    const invitee = await register('Ayu Invitee');
    const declined = await invite(owner, invitee, 'Tolak Labs');
    const expired = await invite(owner, invitee, 'Lama Labs');
    getDatabase().prepare('UPDATE workspace_invitations SET expires_at = ? WHERE workspace_id = ?').run(Date.now() - 1, expired);

    await openTab(invitee.cookie, '/profile');
    await click('[data-testid="notifications-bell"]');
    expect(rows()).toHaveLength(2);

    const row = (name: string) => rows().find((item) => item.textContent?.includes(name))!;
    row('Tolak Labs').querySelector<HTMLButtonElement>('[data-testid="invite-decline"]')!.click();
    await settle();
    expect(isMember(declined, invitee.id)).toBe(false);
    expect(rows().map((item) => item.textContent)).toEqual([expect.stringContaining('Lama Labs')]);

    row('Lama Labs').querySelector<HTMLButtonElement>('[data-testid="invite-accept"]')!.click();
    await settle();
    expect(isMember(expired, invitee.id)).toBe(false);
    expect(container.querySelector('[data-testid="notifications-menu"] [role="alert"]')?.textContent).toContain('Undangan ini sudah kedaluwarsa');
  });

  it('marks one notification read on click and the rest with Tandai dibaca', async () => {
    const owner = await register('Dimas Owner');
    const first = await register('Ayu Invitee');
    const second = await register('Bima Invitee');
    const one = await invite(owner, first, 'Satu Labs');
    const two = await invite(owner, second, 'Dua Labs');
    await openTab(owner.cookie, '/profile');
    expect(dot()).toBeNull();

    for (const [account, workspaceId] of [[first, one], [second, two]] as const) {
      const token = getDatabase().prepare('SELECT token FROM workspace_invitations WHERE workspace_id = ?').get(workspaceId) as { token: string };
      expect((await asDevice(account.cookie, `/api/invitations/${token.token}/respond`, 'POST', { action: 'accept' })).status).toBe(200);
    }
    await settle();
    await click('[data-testid="notifications-bell"]');
    expect(rows().map((item) => item.dataset.unread)).toEqual(['true', 'true']);
    expect(rows()[0]!.textContent).toContain('Bima Invitee nerima undangan ke Dua Labs');

    rows()[0]!.querySelector<HTMLButtonElement>('button.notif__text')!.click();
    await settle();
    expect(rows().map((item) => item.dataset.unread)).toEqual(['false', 'true']);
    expect(container.querySelector('[data-testid="notifications-bell"]')?.getAttribute('aria-label')).toBe('Notifikasi, 1 belum dibaca');

    await click('[data-testid="notifications-read-all"]');
    expect(rows().map((item) => item.dataset.unread)).toEqual(['false', 'false']);
    expect(dot()).toBeNull();
    const unread = getDatabase().prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(owner.id) as { count: number };
    expect(unread.count).toBe(0);
  });
});
