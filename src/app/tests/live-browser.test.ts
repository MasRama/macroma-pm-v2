/// <reference lib="dom" />
import { File as NodeFile } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createApp, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import router from '../router';
import { app as serverApp } from '../server';
import { useAuthSession } from '../../features/auth/web';
import { notify } from '../../features/notifications';
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

/**
 * jsdom's FormData takes only jsdom files and Node's Request cannot read it,
 * so uploads use this stand-in and go to the server as real multipart bodies.
 */
class TabFormData {
  readonly entries: Array<[string, string | NodeFile, string | undefined]> = [];

  append(name: string, value: string | NodeFile, filename?: string): void {
    this.entries.push([name, value, filename]);
  }
}

async function encodeMultipart(form: TabFormData): Promise<{ body: ArrayBuffer; contentType: string }> {
  const boundary = `----macroma-test-${randomUUID()}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value, filename] of form.entries) {
    if (typeof value === 'string') {
      parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      continue;
    }
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename ?? value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`,
      ),
      new Uint8Array(await value.arrayBuffer()),
      encoder.encode('\r\n'),
    );
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }
  return { body: body.buffer as ArrayBuffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

function installTabFetch(): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    track(
      (async () => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://nara.test');
        const headers = new Headers(init?.headers);
        if (tabCookie) headers.set('Cookie', tabCookie);
        let body = init?.body;
        if (body instanceof TabFormData) {
          const encoded = await encodeMultipart(body);
          body = encoded.body;
          headers.set('Content-Type', encoded.contentType);
        }
        const response = await serverApp.request(url.pathname + url.search, { method: init?.method ?? 'GET', headers, body });
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
  vi.stubGlobal('FormData', TabFormData);
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

  it('keeps its page when another tab of this browser changes the password and the renewed cookie lands late', async () => {
    const account = await register();
    await openTab(account.cookie, '/security');

    // The other tab shares this cookie. The server ends every stream before
    // its response sets the renewed session, so this tab asks /me with the
    // old cookie first and is refused; the renewed cookie lands right after.
    const otherTab = asDevice(tabCookie, '/api/auth/change-password', 'POST', {
      current_password: PASSWORD,
      new_password: 'another horse battery staple',
    });
    const tabFetch = globalThis.fetch;
    let renewal: typeof otherTab | undefined = otherTab;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await tabFetch(input, init);
      if (renewal && String(input).endsWith('/api/auth/me') && response.status === 401) {
        tabCookie = (await renewal).cookie;
        renewal = undefined;
      }
      return response;
    });
    expect((await otherTab).status).toBe(200);
    await settle();

    expect(renewal).toBeUndefined();
    expect(useAuthSession().isAuthenticated.value).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/security');
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

  it("follows another administrator's save into the open user form after the account leaves the shown list", async () => {
    const admin = await register();
    grantRole(admin.id, 'admin');
    const colleague = await register();
    grantRole(colleague.id, 'admin');
    const marker = `Shared ${randomUUID().slice(0, 8)}`;
    const target = await register(marker);
    await openTab(admin.cookie, '/users');
    type('#user-search', marker);
    container.querySelector<HTMLFormElement>('[data-testid="user-search-form"]')!.requestSubmit();
    await settle();
    await click(`[data-testid="edit-user-${target.id}"]`);
    const phone = document.querySelector<HTMLInputElement>('#user-phone')!;
    phone.value = '0812 3456 789';
    phone.dispatchEvent(new Event('input'));
    await settle();

    // Their new name no longer matches the search, so the account drops off the list in view.
    expect((await asDevice(colleague.cookie, `/api/users/${target.id}`, 'PUT', { revision: 1, name: 'Renamed Elsewhere' })).status).toBe(200);
    await settle();

    expect(container.querySelector(`[data-user-id="${target.id}"]`)).toBeNull();
    expect(document.querySelector<HTMLInputElement>('#user-name')?.value).toBe('Renamed Elsewhere');
    expect(document.querySelector<HTMLInputElement>('#user-phone')?.value).toBe('0812 3456 789');
    expect(document.querySelector('[data-testid="user-merge-notice"]')?.textContent).toContain('Nama');

    document.querySelector<HTMLFormElement>('[data-testid="user-form"]')!.requestSubmit();
    await settle();
    expect(getDatabase().prepare('SELECT name, phone, revision FROM users WHERE id = ?').get(target.id)).toEqual({
      name: 'Renamed Elsewhere',
      phone: '0812 3456 789',
      revision: 3,
    });
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

  it("shows another account's move of my task and opens that task on click", async () => {
    const owner = await register('Board Owner');
    const mover = await register('Azka Mover');
    expect((await asDevice(owner.cookie, '/api/projects', 'POST', { name: 'Bell Board' })).status).toBe(201);
    const project = getDatabase().prepare('SELECT id FROM projects WHERE owner_id = ?').get(owner.id) as { id: string };
    expect((await asDevice(owner.cookie, `/api/projects/${project.id}/members`, 'POST', { email: mover.email })).status).toBe(201);
    expect((await asDevice(owner.cookie, `/api/projects/${project.id}/tasks`, 'POST', { title: 'Ship the bell' })).status).toBe(201);
    const task = getDatabase().prepare('SELECT id FROM tasks WHERE project_id = ?').get(project.id) as { id: string };

    await openTab(owner.cookie, '/profile');
    expect(dot()).toBeNull();
    expect((await asDevice(mover.cookie, `/api/tasks/${task.id}/move`, 'PATCH', { column_id: 'review' })).status).toBe(200);
    await settle();
    expect(dot()).not.toBeNull();

    const notice = getDatabase().prepare("SELECT id, data_json FROM notifications WHERE user_id = ? AND type = 'task_moved'").get(owner.id) as {
      id: string;
      data_json: string;
    };
    const { version } = JSON.parse(notice.data_json) as { version: string };
    await click('[data-testid="notifications-bell"]');
    expect(rows()).toHaveLength(1);
    const text = rows()[0]!.textContent?.replace(/\s+/g, ' ');
    expect(text).toMatch(/Azka Mover mindahin Ship the bell ke\s*Backlog/);
    expect(text).toMatch(/Backlog.*Review/);
    expect(rows()[0]!.querySelector('.notif__version')?.textContent).toBe(version);

    await click('[data-testid="notification-open-task"]');
    expect(router.currentRoute.value.name).toBe('project-task');
    expect(router.currentRoute.value.params).toEqual({ projectId: project.id, taskId: task.id });
    expect(container.querySelector('[data-testid="notifications-bell"]')?.getAttribute('aria-expanded')).toBe('false');
    const read = getDatabase().prepare('SELECT read_at FROM notifications WHERE id = ?').get(notice.id) as { read_at: number | null };
    expect(read.read_at).not.toBeNull();
    expect(dot()).toBeNull();
  });

  it('lists a notification type the bell does not know, so the count and the rows agree, and marks it read on click', async () => {
    const account = await register('Bell Reader');
    await openTab(account.cookie, '/profile');
    expect(dot()).toBeNull();
    const notice = notify(account.id, 'task_due_soon', { task_title: 'Later' });
    await settle();
    expect(dot()).not.toBeNull();

    await click('[data-testid="notifications-bell"]');
    expect(container.querySelector('[data-testid="notifications-bell"]')?.getAttribute('aria-label')).toBe('Notifikasi, 1 belum dibaca');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.dataset.unread).toBe('true');
    expect(rows()[0]!.textContent).toContain('Notifikasi baru');
    expect(container.querySelector('.notif__empty')).toBeNull();

    rows()[0]!.querySelector<HTMLButtonElement>('button.notif__text')!.click();
    await settle();
    expect(rows()[0]!.dataset.unread).toBe('false');
    const read = getDatabase().prepare('SELECT read_at FROM notifications WHERE id = ?').get(notice.id) as { read_at: number | null };
    expect(read.read_at).not.toBeNull();
    expect(dot()).toBeNull();
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

describe('workspaces and chat in the open tab', () => {
  /** Creates a workspace as `owner`; returns its id. */
  async function createWorkspace(owner: { cookie: string }, name = 'Wajom Studio'): Promise<string> {
    expect((await asDevice(owner.cookie, '/api/workspaces', 'POST', { name, description: 'Tim produk' })).status).toBe(201);
    return (getDatabase().prepare('SELECT id FROM workspaces WHERE name = ? ORDER BY created_at DESC LIMIT 1').get(name) as { id: string }).id;
  }

  async function join(owner: { cookie: string }, member: { email: string; cookie: string }, workspaceId: string): Promise<void> {
    expect((await asDevice(owner.cookie, `/api/workspaces/${workspaceId}/invitations`, 'POST', { email: member.email })).status).toBe(201);
    const { token } = getDatabase().prepare("SELECT token FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending'").get(workspaceId) as {
      token: string;
    };
    expect((await asDevice(member.cookie, `/api/invitations/${token}/respond`, 'POST', { action: 'accept' })).status).toBe(200);
  }

  const page = () => container.querySelector('[data-testid="workspace-page"]');
  const memberIds = () => [...container.querySelectorAll('[data-member-id]')].map((row) => row.getAttribute('data-member-id'));
  const isMember = (workspaceId: string, userId: string) =>
    getDatabase().prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId) !== undefined;

  async function submit(selector: string): Promise<void> {
    document.querySelector<HTMLFormElement>(selector)!.requestSubmit();
    await settle();
  }

  function typeIn(selector: string, value: string): void {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(field).not.toBeNull();
    field!.value = value;
    field!.dispatchEvent(new Event('input'));
  }

  it('opens a workspace with its members and pending invitations, and shows the owner its actions', async () => {
    const owner = await register('Ren Owner');
    const pending = await register('Fajar Pending');
    const workspaceId = await createWorkspace(owner);
    expect((await asDevice(owner.cookie, `/api/workspaces/${workspaceId}/invitations`, 'POST', { email: pending.email })).status).toBe(201);

    await openTab(owner.cookie, `/workspaces/${workspaceId}`);
    expect(page()?.textContent).toContain('Wajom Studio');
    expect(page()?.textContent).toContain('Tim produk · 1 anggota · 0 project');
    expect(memberIds()).toEqual([owner.id]);
    expect(page()?.textContent).toContain('Ren Owner (kamu)');
    expect(page()?.textContent).toContain(pending.email);
    expect(container.querySelector('[data-testid="edit-workspace"]')).not.toBeNull();
    expect(container.querySelector('.ws__text')?.textContent).toContain('Wajom Studio');
    expect(container.querySelector('.me__text')?.textContent).toContain('Owner');
  });

  it('lists only the selected workspace\'s projects in the sidebar and swaps them on a switch', async () => {
    const owner = await register('Ren Owner');
    const studio = await createWorkspace(owner, 'Wajom Studio');
    const labs = await createWorkspace(owner, 'Dua Labs');
    const newProject = async (name: string, workspaceId: string | null): Promise<string> => {
      expect((await asDevice(owner.cookie, '/api/projects', 'POST', { name, workspace_id: workspaceId })).status).toBe(201);
      return (getDatabase().prepare('SELECT id FROM projects WHERE name = ?').get(name) as { id: string }).id;
    };
    await newProject('Wajom Portal', studio);
    await newProject('Stoko App', studio);
    const lab = await newProject('Riset AI', labs);
    await newProject('Catatan pribadi', null);
    const sidebar = () => [...container.querySelectorAll('.side .proj__name')].map((node) => node.textContent?.trim()).sort();

    await openTab(owner.cookie, `/workspaces/${studio}`);
    expect(container.querySelector('.ws__text')?.textContent).toContain('Wajom Studio');
    expect(sidebar()).toEqual(['Stoko App', 'Wajom Portal']);

    // Switching from the switcher swaps the list right away.
    await click('.ws');
    [...document.querySelectorAll<HTMLAnchorElement>('.menu-item')].find((item) => item.textContent?.trim() === 'Dua Labs')!.click();
    await settle();
    expect(container.querySelector('.ws__text')?.textContent).toContain('Dua Labs');
    expect(sidebar()).toEqual(['Riset AI']);

    // A project page keeps the sidebar on that project's workspace.
    await router.push(`/workspaces/${studio}`);
    await settle();
    await router.push(`/projects/${lab}/board`);
    await settle();
    expect(container.querySelector('.ws__text')?.textContent).toContain('Dua Labs');
    expect(sidebar()).toEqual(['Riset AI']);

    // A project made in a workspace on another device shows up in that workspace's list.
    await newProject('Kurikulum', labs);
    await settle();
    expect(sidebar()).toEqual(['Kurikulum', 'Riset AI']);
  });

  it('shows no projects in the sidebar while no workspace is selected', async () => {
    const owner = await register('Ren Owner');
    expect((await asDevice(owner.cookie, '/api/projects', 'POST', { name: 'Catatan pribadi' })).status).toBe(201);
    await openTab(owner.cookie, '/profile');
    expect(container.querySelector('.ws__text')?.textContent).toContain('Pilih workspace');
    expect(container.querySelector('.side .proj__name')).toBeNull();
    expect(container.querySelector('.side .proj__empty')?.textContent).toBe('Belum ada project.');
  });

  it('creates a workspace from the switcher and lands on it', async () => {
    const owner = await register('Ren Owner');
    await openTab(owner.cookie, '/profile');
    expect(container.querySelector('.ws__text')?.textContent).toContain('Pilih workspace');

    await click('.ws');
    await click('.menu-item--add');
    await submit('#new-workspace-form');
    expect(document.body.textContent).toContain('Nama wajib diisi');

    // The server's 422 is worded in Indonesian by field, not shown as its English message.
    typeIn('#workspace-name', 'x'.repeat(256));
    await submit('#new-workspace-form');
    expect(document.body.textContent).toContain('Nama wajib diisi, maksimal 255 karakter.');
    expect(document.body.textContent).not.toContain('Name must be at most');
    expect(getDatabase().prepare('SELECT 1 FROM workspaces WHERE owner_id = ?').get(owner.id)).toBeUndefined();

    typeIn('#workspace-name', 'Nara Labs');
    await submit('#new-workspace-form');
    const created = getDatabase().prepare('SELECT id FROM workspaces WHERE owner_id = ?').get(owner.id) as { id: string };
    expect(router.currentRoute.value).toMatchObject({ name: 'workspace', params: { workspaceId: created.id } });
    expect(page()?.textContent).toContain('Nara Labs');
    expect(container.querySelector('.ws__text')?.textContent).toContain('Nara Labs');
  });

  it('invites by email, says by code when no account uses it, and cancels a pending invitation', async () => {
    const owner = await register('Ren Owner');
    const invitee = await register('Ayu Invitee');
    const workspaceId = await createWorkspace(owner);
    await openTab(owner.cookie, `/workspaces/${workspaceId}`);

    await click('[data-testid="invite-member"]');
    typeIn('#invite-email', `${randomUUID()}@example.com`);
    await submit('#invite-form');
    expect(document.querySelector('#invite-form')?.textContent).toContain('Belum ada akun dengan email ini');

    typeIn('#invite-email', invitee.email);
    await submit('#invite-form');
    expect(document.querySelector('#invite-form')).toBeNull();
    expect(page()?.textContent).toContain(invitee.email);

    const invitation = getDatabase().prepare("SELECT id FROM workspace_invitations WHERE workspace_id = ? AND status = 'pending'").get(workspaceId) as { id: string };
    await click(`[data-testid="cancel-invite-${invitation.id}"]`);
    expect(page()?.textContent).not.toContain(invitee.email);
    expect(getDatabase().prepare('SELECT 1 FROM workspace_invitations WHERE id = ?').get(invitation.id)).toBeUndefined();
  });

  it('shows a member joining live, hides owner actions from a member, and lets a member leave', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const workspaceId = await createWorkspace(owner);
    await openTab(owner.cookie, `/workspaces/${workspaceId}`);
    expect(memberIds()).toEqual([owner.id]);

    await join(owner, member, workspaceId);
    await settle();
    expect(memberIds()).toEqual([owner.id, member.id]);
    expect(container.querySelector(`[data-testid="remove-member-${member.id}"]`)).not.toBeNull();

    application?.unmount();
    application = undefined;
    await openTab(member.cookie, `/workspaces/${workspaceId}`);
    expect(container.querySelector('[data-testid="edit-workspace"]')).toBeNull();
    expect(container.querySelector(`[data-testid="remove-member-${owner.id}"]`)).toBeNull();
    expect(container.querySelector('[data-testid="invite-member"]')).not.toBeNull();

    await click('[data-testid="leave-workspace"]');
    document.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn--danger')!.click();
    await settle();
    expect(isMember(workspaceId, member.id)).toBe(false);
    expect(router.currentRoute.value.name).toBe('dashboard');
  });

  it('merges an edit saved elsewhere into the open form and asks only about the field both changed', async () => {
    const owner = await register('Ren Owner');
    const workspaceId = await createWorkspace(owner);
    await openTab(owner.cookie, `/workspaces/${workspaceId}`);

    await click('[data-testid="edit-workspace"]');
    typeIn('#edit-workspace-description', 'Deskripsi punyaku');
    typeIn('#edit-workspace-name', 'Nama punyaku');
    await settle();
    expect((await asDevice(owner.cookie, `/api/workspaces/${workspaceId}`, 'PATCH', { revision: 1, name: 'Nama mereka' })).status).toBe(200);

    await submit('#edit-workspace-form');
    expect(document.querySelector('[data-testid="workspace-merge-notice"]')?.textContent).toContain('disimpan orang lain');
    const conflicts = [...document.querySelectorAll('[data-testid="workspace-conflicts"] [data-conflict-field]')].map((row) => row.getAttribute('data-conflict-field'));
    expect(conflicts).toEqual(['name']);
    expect((document.querySelector('#edit-workspace-description') as HTMLTextAreaElement).value).toBe('Deskripsi punyaku');

    document.querySelector<HTMLButtonElement>('[data-testid="use-theirs-name"]')!.click();
    await settle();
    await submit('#edit-workspace-form');
    expect(document.querySelector('#edit-workspace-form')).toBeNull();
    expect(getDatabase().prepare('SELECT name, description, revision FROM workspaces WHERE id = ?').get(workspaceId)).toEqual({
      name: 'Nama mereka',
      description: 'Deskripsi punyaku',
      revision: 3,
    });
  });

  it('counts chat messages from others while the chat is closed, then shows and sends in the drawer', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const workspaceId = await createWorkspace(owner);
    await join(owner, member, workspaceId);
    await openTab(owner.cookie, `/workspaces/${workspaceId}`);
    const chatButton = () => [...container.querySelectorAll<HTMLButtonElement>('button.nav__a')].find((button) => button.textContent?.includes('Chat'))!;
    expect(chatButton().querySelector('.badge')).toBeNull();

    expect((await asDevice(member.cookie, `/api/workspaces/${workspaceId}/messages`, 'POST', { message: 'Halo tim' })).status).toBe(201);
    expect((await asDevice(member.cookie, `/api/workspaces/${workspaceId}/messages`, 'POST', { message: 'Ada yang review?' })).status).toBe(201);
    await settle();
    expect(chatButton().querySelector('.badge')?.textContent).toBe('2');

    chatButton().click();
    await settle();
    const drawer = () => document.querySelector('[role="dialog"][aria-label="Chat Wajom Studio"]');
    expect(drawer()?.textContent).toContain('Halo tim');
    expect(drawer()?.textContent).toContain('Ada yang review?');
    expect(chatButton().querySelector('.badge')).toBeNull();

    typeIn('[data-testid="chat-input"]', 'Aku cek siang ini');
    await settle();
    await submit('.chat__compose');
    expect((document.querySelector('[data-testid="chat-input"]') as HTMLInputElement).value).toBe('');
    expect(drawer()?.textContent).toContain('Aku cek siang ini');
    const saved = getDatabase().prepare('SELECT message FROM workspace_messages WHERE workspace_id = ? AND user_id = ?').all(workspaceId, owner.id);
    expect(saved).toEqual([{ message: 'Aku cek siang ini' }]);
  });
});

describe('projects, the board and the dashboard in the open tab', () => {
  const db = () => getDatabase();

  async function createProject(owner: { cookie: string }, name = 'Wajom Portal', workspaceId?: string): Promise<string> {
    const body = workspaceId ? { name, workspace_id: workspaceId } : { name };
    expect((await asDevice(owner.cookie, '/api/projects', 'POST', body)).status).toBe(201);
    return (db().prepare('SELECT id FROM projects WHERE name = ? ORDER BY created_at DESC LIMIT 1').get(name) as { id: string }).id;
  }

  async function openBatch(owner: { cookie: string }, projectId: string, input: Record<string, unknown> = { activate: true }): Promise<void> {
    expect((await asDevice(owner.cookie, `/api/projects/${projectId}/batches`, 'POST', input)).status).toBe(201);
  }

  async function createTask(actor: { cookie: string }, projectId: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
    expect((await asDevice(actor.cookie, `/api/projects/${projectId}/tasks`, 'POST', { title, ...extra })).status).toBe(201);
    return (db().prepare('SELECT id FROM tasks WHERE project_id = ? AND title = ?').get(projectId, title) as { id: string }).id;
  }

  async function move(actor: { cookie: string }, taskId: string, column: string, note = 'Catatan'): Promise<void> {
    expect((await asDevice(actor.cookie, `/api/tasks/${taskId}/move`, 'PATCH', { column_id: column, note })).status).toBe(200);
  }

  async function addMember(owner: { cookie: string }, projectId: string, member: { email: string }): Promise<void> {
    expect((await asDevice(owner.cookie, `/api/projects/${projectId}/members`, 'POST', { email: member.email })).status).toBe(201);
  }

  const column = (status: string) => container.querySelector(`.board [data-status="${status}"]`);
  const cardIn = (status: string, taskId: string) => column(status)?.querySelector(`[data-task-id="${taskId}"]`) ?? null;
  const taskRow = (taskId: string) =>
    db().prepare('SELECT column_id, version_major, version_minor, version_patch, title, description FROM tasks WHERE id = ?').get(taskId) as {
      column_id: string;
      version_major: number;
      version_minor: number;
      version_patch: number;
      title: string;
      description: string | null;
    };

  async function submit(selector: string): Promise<void> {
    document.querySelector<HTMLFormElement>(selector)!.requestSubmit();
    await settle();
  }

  function typeIn(selector: string, value: string): void {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(field).not.toBeNull();
    field!.value = value;
    field!.dispatchEvent(new Event('input'));
  }

  /** Clicks a button in a modal (modals render under document.body). */
  async function press(selector: string): Promise<void> {
    const button = document.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    button!.click();
    await settle();
  }

  function tile(label: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.move__tile')].find((button) => button.textContent?.trim() === label);
    expect(found).toBeDefined();
    return found!;
  }

  it('creates a project from the workspace page, lists it in the sidebar and on the workspace cards', async () => {
    const owner = await register('Ren Owner');
    expect((await asDevice(owner.cookie, '/api/workspaces', 'POST', { name: 'Wajom Studio' })).status).toBe(201);
    const workspaceId = (db().prepare('SELECT id FROM workspaces WHERE owner_id = ?').get(owner.id) as { id: string }).id;
    await openTab(owner.cookie, `/workspaces/${workspaceId}`);
    expect(container.querySelector('[data-testid="workspace-page"]')?.textContent).toContain('Belum ada project');

    await click('[data-testid="workspace-new-project"]');
    typeIn('#project-name', 'Wajom Portal');
    typeIn('#project-description', 'Portal client WhatsApp gateway.');
    await settle();
    await submit('#new-project-form');
    const projectId = (db().prepare('SELECT id, workspace_id FROM projects WHERE owner_id = ?').get(owner.id) as { id: string; workspace_id: string });
    expect(projectId.workspace_id).toBe(workspaceId);
    expect(router.currentRoute.value).toMatchObject({ name: 'project-board', params: { projectId: projectId.id } });
    expect(container.querySelector('.proj__name')?.textContent).toBe('Wajom Portal');
    // The breadcrumb names the project's workspace.
    expect(container.querySelector('[data-testid="board-page"]')?.textContent).toContain('Wajom Studio');

    await router.push(`/workspaces/${workspaceId}`);
    await settle();
    const card = container.querySelector(`.pcard[data-project-id="${projectId.id}"]`);
    expect(card?.textContent).toContain('Portal client WhatsApp gateway.');
    expect(card?.textContent).toContain('0/0 selesai');
    expect(card?.textContent).toContain('1 anggota');
  });

  it('shows the active batch, its five columns and a card that came back from review', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId, { label: 'Pairing flow', activate: true });
    const taskId = await createTask(owner, projectId, 'Checkout Midtrans gagal di Safari iOS', { priority: 'high' });
    await move(owner, taskId, 'review');
    await move(owner, taskId, 'revisi', 'Masih gagal di iPhone 12');

    await openTab(owner.cookie, `/projects/${projectId}/board`);
    expect([...container.querySelectorAll('.board [data-status]')].map((node) => node.getAttribute('data-status'))).toEqual([
      'backlog',
      'ongoing',
      'revisi',
      'review',
      'done',
    ]);
    expect(container.querySelector('.batch')?.textContent).toContain('Pairing flow');
    const card = cardIn('revisi', taskId);
    expect(card?.textContent).toContain('Balik dari review · 1x');
    expect(card?.textContent).toContain('v0.1.3');
  });

  it('creates a task from Task baru and moves it with a required note, previewing its next version', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    await createTask(owner, projectId, 'Halaman 404');
    await openTab(owner.cookie, `/projects/${projectId}/board`);

    await click('[data-testid="new-task"]');
    expect(document.body.textContent).toContain('mulai di v0.1.2');
    // The server's 422 on the title is worded in Indonesian, not shown as its English message.
    typeIn('#new-task-title', 'x'.repeat(501));
    await settle();
    await submit('#new-task-form');
    expect(document.body.textContent).toContain('Judul wajib diisi, maksimal 500 karakter.');
    expect(document.body.textContent).not.toContain('Title must be at most');
    expect(db().prepare('SELECT 1 FROM tasks WHERE project_id = ? AND length(title) > 500').get(projectId)).toBeUndefined();

    typeIn('#new-task-title', 'Export riwayat broadcast ke CSV');
    await settle();
    await submit('#new-task-form');
    const taskId = (db().prepare('SELECT id FROM tasks WHERE title = ?').get('Export riwayat broadcast ke CSV') as { id: string }).id;
    expect(cardIn('backlog', taskId)?.textContent).toContain('v0.1.2');

    (cardIn('backlog', taskId) as HTMLElement).click();
    await settle();
    expect(router.currentRoute.value).toMatchObject({ name: 'project-task', params: { taskId } });
    await press('[data-testid="task-move"]');
    tile('Review').click();
    await settle();
    expect(document.querySelector('.move__to')?.textContent).toContain('v0.1.3');
    await submit('#move-task-form');
    expect(document.body.textContent).toContain('Catatan wajib diisi');
    expect(taskRow(taskId).column_id).toBe('backlog');

    typeIn('#move-task-note', 'Siap direview');
    await settle();
    await submit('#move-task-form');
    expect(document.querySelector('#move-task-form')).toBeNull();
    expect(taskRow(taskId)).toMatchObject({ column_id: 'review', version_patch: 3 });
    expect(cardIn('review', taskId)).not.toBeNull();
    // The detail's version history now has the move.
    expect(document.body.textContent).toContain('Riwayat versi 2');
  });

  it('lets the owner bump the version and hides owner actions from a member', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    await addMember(owner, projectId, member);
    const taskId = await createTask(owner, projectId, 'Webhook retry');

    await openTab(owner.cookie, `/projects/${projectId}/board`);
    await click('[aria-haspopup="menu"]');
    const minor = [...container.querySelectorAll<HTMLButtonElement>('.bump')].find((button) => button.textContent?.includes('Minor'));
    minor!.click();
    await settle();
    const active = db().prepare('SELECT major, minor FROM project_batches WHERE project_id = ? AND is_active = 1').get(projectId);
    expect(active).toEqual({ major: 0, minor: 2 });
    expect(container.querySelector('.batch')?.textContent).toContain('v0.2');

    application?.unmount();
    application = undefined;
    await openTab(member.cookie, `/projects/${projectId}/tasks/${taskId}`);
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(document.querySelector('[data-testid="task-edit"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="task-delete"]')).toBeNull();
  });

  it('lets the owner of a project without batches open its first one from the board', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, member);

    await openTab(owner.cookie, `/projects/${projectId}/board`);
    const hint = () => container.querySelector('[data-testid="no-batch"]');
    expect(hint()?.textContent).toContain('Belum ada batch aktif.');
    expect(hint()?.textContent).toMatch(/Minor jadi\s+v0\.1, Major jadi\s+v1\.0/);
    expect(hint()?.textContent).toContain('Setelah itu baru bisa bikin task.');
    // Tasks always start in Backlog, so only that column offers one. A task needs a batch, so both
    // Task baru and the Backlog + stay disabled until the first bump.
    const adders = () => [...container.querySelectorAll<HTMLButtonElement>('.board [data-status] [aria-label^="Task baru di"]')];
    expect(adders().map((node) => node.closest('[data-status]')?.getAttribute('data-status'))).toEqual(['backlog']);
    expect(adders()[0]?.disabled).toBe(true);
    const newTask = () => container.querySelector<HTMLButtonElement>('[data-testid="new-task"]');
    expect(newTask()?.disabled).toBe(true);
    // The phone layout's bottom bar has its own Task baru, held back the same way.
    const phoneNewTask = () => container.querySelector<HTMLButtonElement>('.phone-board__bar [data-testid="new-task-phone"]');
    expect(phoneNewTask()?.disabled).toBe(true);
    adders()[0]?.click();
    newTask()?.click();
    phoneNewTask()?.click();
    await settle();
    expect(document.querySelector('#new-task-title')).toBeNull();

    await click('.board-page__head [data-testid="bump-version"]');
    const option = (kind: string) => container.querySelector<HTMLButtonElement>(`.board-page__head [data-testid="bump-${kind}"]`)!;
    expect(option('minor').textContent).toContain('→ v0.1');
    expect(option('major').textContent).toContain('→ v1.0');
    expect(option('minor').textContent).toContain('Batch pertama project ini.');
    option('minor').click();
    await settle();
    const active = db().prepare('SELECT major, minor FROM project_batches WHERE project_id = ? AND is_active = 1').get(projectId);
    expect(active).toEqual({ major: 0, minor: 1 });
    expect(hint()).toBeNull();
    expect(container.querySelector('.batch')?.textContent).toContain('v0.1');
    expect(newTask()?.disabled).toBe(false);
    expect(phoneNewTask()?.disabled).toBe(false);
    expect(adders()[0]?.disabled).toBe(false);

    application?.unmount();
    application = undefined;
    const empty = await createProject(owner, 'Proyek Kosong');
    await addMember(owner, empty, member);
    await openTab(member.cookie, `/projects/${empty}/board`);
    expect(hint()?.textContent).toContain('Task baru bisa dibuat setelah owner project bump versi.');
    expect(container.querySelector('[data-testid="bump-version"]')).toBeNull();
    expect(newTask()?.disabled).toBe(true);
    expect(phoneNewTask()?.disabled).toBe(true);
  });

  it('shows released batches on Rilis, keeps the chosen one in the URL and bumps from there', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const projectId = await createProject(owner);
    await addMember(owner, projectId, member);
    await openBatch(owner, projectId, { label: 'Template pesan', activate: true });
    const greeting = await createTask(owner, projectId, 'Pesan sambutan', { priority: 'high', assignee_id: member.id });
    await move(owner, greeting, 'done');
    await openBatch(owner, projectId, { label: 'Billing', activate: true });
    await createTask(owner, projectId, 'Invoice PDF');
    const batchId = (minor: number) =>
      (db().prepare('SELECT id FROM project_batches WHERE project_id = ? AND minor = ?').get(projectId, minor) as { id: string }).id;

    await openTab(owner.cookie, `/projects/${projectId}/releases`);
    const activeBlock = () => container.querySelector('[data-testid="release-active"]');
    const items = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="release-item"]')];
    const detail = () => container.querySelector('[data-testid="release-detail"]');
    const flat = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(flat(activeBlock())).toContain('v0.2');
    expect(flat(activeBlock())).toContain('Billing');
    expect(flat(activeBlock())).toContain('0 /1');
    expect(items().map((item) => item.dataset.releaseId)).toEqual([batchId(1)]);
    expect(flat(items()[0])).toContain('Template pesan');
    // Without ?release= the latest closed release is the one shown.
    expect(items()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(flat(detail())).toContain('v0.1');
    expect(flat(detail())).toMatch(/Rilis \d+ \w+/);
    expect(flat(detail())).toContain('Pesan sambutan');

    const contributors = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="release-detail"] [role="tab"]')].find((tab) =>
      tab.textContent?.includes('Kontributor'),
    );
    contributors!.click();
    await settle();
    const people = [...container.querySelectorAll('[data-testid="contributor-row"]')].map(flat);
    expect(people.some((row) => row.includes('Ayu Member'))).toBe(true);

    // A task made elsewhere reaches the active block live.
    await createTask(member, projectId, 'Reminder jatuh tempo');
    await settle();
    expect(flat(activeBlock())).toContain('0 /2');

    // Pick the release so the URL names it: the bump must drop it to show the release it just closed.
    items()[0]!.click();
    await settle();
    expect(router.currentRoute.value.query.release).toBe(batchId(1));

    await click('[data-testid="bump-version"]');
    const minor = document.querySelector<HTMLButtonElement>('[data-testid="bump-minor"]')!;
    expect(minor.textContent).toContain('v0.2 → v0.3');
    expect(minor.textContent).toContain('Batch v0.2 ditutup.');
    minor.click();
    await settle();
    expect(flat(activeBlock())).toContain('v0.3');
    expect(items().map((item) => item.dataset.releaseId)).toEqual([batchId(2), batchId(1)]);
    expect(router.currentRoute.value.query.release).toBeUndefined();
    expect(items()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(flat(detail())).toContain('Invoice PDF');

    items()[1]!.click();
    await settle();
    expect(router.currentRoute.value.query.release).toBe(batchId(1));
    expect(items()[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(flat(detail())).toContain('Pesan sambutan');

    // A member opens the linked release and has no Bump versi.
    application?.unmount();
    application = undefined;
    await openTab(member.cookie, `/projects/${projectId}/releases?release=${batchId(1)}`);
    expect(flat(detail())).toContain('Pesan sambutan');
    expect(container.querySelector('[data-testid="bump-version"]')).toBeNull();

    await router.push(`/projects/${projectId}/releases?release=missing`);
    await settle();
    expect(container.querySelector('[data-testid="release-detail-empty"]')?.textContent).toContain('Rilis ini sudah tidak ada.');
  });

  it('counts Rilis Bump versi on the project\'s highest batch, above the active one', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId, { label: 'Template pesan', activate: true });
    // An upcoming batch, not active yet: the project's highest version is v0.2 while v0.1 is active.
    await openBatch(owner, projectId, { label: 'Billing', activate: false });

    await openTab(owner.cookie, `/projects/${projectId}/releases`);
    await click('[data-testid="bump-version"]');
    const minor = document.querySelector<HTMLButtonElement>('[data-testid="bump-minor"]')!;
    const major = document.querySelector<HTMLButtonElement>('[data-testid="bump-major"]')!;
    expect(minor.textContent).toContain('v0.2 → v0.3');
    expect(major.textContent).toContain('v0.2 → v1.0');
    expect(minor.textContent).toContain('Batch v0.1 ditutup.');
  });

  it('merges a task edit saved elsewhere and asks only about the field both changed', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    const taskId = await createTask(owner, projectId, 'Pairing code');
    await openTab(owner.cookie, `/projects/${projectId}/tasks/${taskId}`);

    await press('[data-testid="task-edit"]');
    typeIn('#edit-task-title', 'Judul punyaku');
    typeIn('#edit-task-description', 'Deskripsi punyaku');
    await settle();
    expect((await asDevice(owner.cookie, `/api/tasks/${taskId}`, 'PATCH', { revision: 1, title: 'Judul mereka' })).status).toBe(200);

    await submit('#edit-task-form');
    expect(document.querySelector('[data-testid="task-merge-notice"]')?.textContent).toContain('disimpan orang lain');
    const conflicts = [...document.querySelectorAll('[data-testid="task-conflicts"] [data-conflict-field]')].map((row) => row.getAttribute('data-conflict-field'));
    expect(conflicts).toEqual(['title']);

    document.querySelector<HTMLButtonElement>('[data-testid="task-keep-mine-title"]')!.click();
    await settle();
    await submit('#edit-task-form');
    expect(document.querySelector('#edit-task-form')).toBeNull();
    expect(taskRow(taskId)).toMatchObject({ title: 'Judul punyaku', description: 'Deskripsi punyaku' });
  });

  it('deletes a task as the owner and follows tasks made on another device', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    const taskId = await createTask(owner, projectId, 'Logo baru');
    await openTab(owner.cookie, `/projects/${projectId}/tasks/${taskId}`);

    await press('[data-testid="task-delete"]');
    document.querySelector<HTMLButtonElement>('[role="alertdialog"] .btn--danger')!.click();
    await settle();
    expect(db().prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)).toBeUndefined();
    expect(router.currentRoute.value.name).toBe('project-board');
    expect(container.querySelector(`.board [data-task-id="${taskId}"]`)).toBeNull();

    const otherId = await createTask(owner, projectId, 'Dibuat di HP');
    await settle();
    expect(cardIn('backlog', otherId)?.textContent).toContain('Dibuat di HP');
  });

  it('shows the dashboard stats and board health from the API', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    const first = await createTask(owner, projectId, 'Satu', { assignee_id: owner.id });
    await createTask(owner, projectId, 'Dua');
    await move(owner, first, 'ongoing');

    await openTab(owner.cookie, '/dashboard');
    const values = [...container.querySelectorAll('.stat__value')].map((node) => node.textContent?.trim());
    expect(values).toEqual(['1', '1', '0', '0']);
    expect(container.querySelector('.stat')?.textContent).toContain('di 1 project');
    const row = container.querySelector(`[data-project-id="${projectId}"]`);
    expect(row?.textContent).toContain('Wajom Portal');
    expect(row?.textContent).toContain('0/2');
    expect(container.querySelector('.feed__list')?.textContent).toMatch(/Ren Owner mindahin Satu\s*ke/);
  });

  const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const pngFile = (name: string) => new NodeFile([ONE_PIXEL_PNG], name, { type: 'image/png' });
  const textFile = (name: string) => new NodeFile(['not an image'], name, { type: 'text/plain' });

  /** Picks files in a dropzone's file input, as the file dialog would. */
  async function chooseFiles(selector: string, files: NodeFile[]): Promise<void> {
    const input = document.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    Object.defineProperty(input!, 'files', { configurable: true, value: files });
    input!.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
  }

  async function showDetailTab(label: string): Promise<void> {
    const found = [...document.querySelectorAll<HTMLButtonElement>('.td__main [role="tab"]')].find((tab) => tab.textContent?.trim().startsWith(label));
    expect(found).toBeDefined();
    found!.click();
    await settle();
  }

  const comments = (taskId: string) =>
    db().prepare('SELECT user_id, content FROM task_comments WHERE task_id = ? ORDER BY created_at').all(taskId) as Array<{ user_id: string; content: string }>;
  const images = (taskId: string) =>
    db().prepare('SELECT id, name, uploaded_by FROM task_attachments WHERE task_id = ? ORDER BY created_at').all(taskId) as Array<{
      id: string;
      name: string;
      uploaded_by: string;
    }>;

  it('refuses an over-long comment in Indonesian, sends one, and follows comments and moves from another device', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    await addMember(owner, projectId, member);
    const taskId = await createTask(owner, projectId, 'Pairing code');
    await openTab(owner.cookie, `/projects/${projectId}/tasks/${taskId}`);
    await showDetailTab('Komentar');
    expect(document.querySelector('.td__pane')?.textContent).toContain('Belum ada komentar.');

    typeIn('#task-comment', 'x'.repeat(2001));
    await settle();
    await submit('.td__reply');
    expect(document.body.textContent).toContain('Komentar wajib diisi, maksimal 2000 karakter.');
    expect(comments(taskId)).toEqual([]);

    typeIn('#task-comment', 'Kode expired terlalu cepat di Android lama.');
    await settle();
    await submit('.td__reply');
    expect(comments(taskId)).toEqual([{ user_id: owner.id, content: 'Kode expired terlalu cepat di Android lama.' }]);
    expect(document.querySelector<HTMLTextAreaElement>('#task-comment')?.value).toBe('');
    expect(document.querySelector('.td__comments')?.textContent).toContain('Kode expired terlalu cepat di Android lama.');
    expect(document.body.textContent).not.toContain('Komentar wajib diisi');

    expect((await asDevice(member.cookie, `/api/tasks/${taskId}/comments`, 'POST', { content: 'Siap, aku cek.' })).status).toBe(201);
    await settle();
    const lines = [...document.querySelectorAll('.td__comment')].map((row) => row.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Ayu Member');
    expect(lines[1]).toContain('Siap, aku cek.');

    // A move made elsewhere refreshes the detail without dropping the open tab or a draft being typed.
    typeIn('#task-comment', 'Draft yang belum dikirim');
    await settle();
    await move(member, taskId, 'ongoing');
    await settle();
    expect(document.querySelector('.td__main [role="tab"][aria-selected="true"]')?.textContent).toContain('Komentar');
    expect(document.querySelector<HTMLTextAreaElement>('#task-comment')?.value).toBe('Draft yang belum dikirim');
    expect(document.querySelector('.td__rail')?.textContent).toContain('On going');
  });

  it("keeps the next task's draft when a comment sent on the previous task lands after switching", async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    const first = await createTask(owner, projectId, 'Pairing code');
    const second = await createTask(owner, projectId, 'Halaman 404');
    await openTab(owner.cookie, `/projects/${projectId}/tasks/${first}`);
    await showDetailTab('Komentar');

    // Hold the comment's POST until the person has moved on to the other task.
    const send = globalThis.fetch;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' && String(input).includes(`/tasks/${first}/comments`) ? held.then(() => send(input, init)) : send(input, init),
    );
    typeIn('#task-comment', 'Untuk task pertama');
    await settle();
    await submit('.td__reply');

    await router.push(`/projects/${projectId}/tasks/${second}`);
    await settle();
    await showDetailTab('Komentar');
    typeIn('#task-comment', 'Draft task kedua');
    await settle();
    release();
    await settle();
    await settle();

    expect(comments(first)).toEqual([{ user_id: owner.id, content: 'Untuk task pertama' }]);
    expect(document.querySelector<HTMLTextAreaElement>('#task-comment')?.value).toBe('Draft task kedua');
    expect(document.querySelector('.td__pane')?.textContent).not.toContain('Untuk task pertama');
  });

  it('scrolls the chosen detail tab into sight, for phones where the tab row is wider than the screen', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    const taskId = await createTask(owner, projectId, 'Pairing code');
    const revealed: { tab: string; options: unknown }[] = [];
    // jsdom has no layout, so record the calls instead of scrolling.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement, options: unknown) {
        if (this.getAttribute('role') === 'tab' && this.closest('.td__main')) revealed.push({ tab: this.textContent!.trim(), options });
      },
    });
    try {
      await openTab(owner.cookie, `/projects/${projectId}/tasks/${taskId}`);
      expect(revealed.at(-1)?.tab).toBe('Detail');
      await showDetailTab('Gambar');
      expect(revealed.at(-1)).toEqual({ tab: 'Gambar 0', options: { inline: 'nearest', block: 'nearest' } });
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('uploads images from the detail, shows them by the API url, and lets only the uploader or owner delete them', async () => {
    const owner = await register('Ren Owner');
    const member = await register('Ayu Member');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    await addMember(owner, projectId, member);
    const taskId = await createTask(owner, projectId, 'Halaman 404');
    await openTab(member.cookie, `/projects/${projectId}/tasks/${taskId}`);
    await showDetailTab('Gambar');
    expect(document.querySelector('.td__pane')?.textContent).toContain('Belum ada gambar.');

    // A wrong file is named in Indonesian and never sent.
    await chooseFiles('#task-detail-images', [textFile('catatan.txt')]);
    expect(document.querySelector('[data-testid="task-image-error"]')?.textContent).toBe('catatan.txt: harus JPEG, PNG, GIF, atau WebP.');
    expect(images(taskId)).toEqual([]);

    await chooseFiles('#task-detail-images', [pngFile('layar-member.png')]);
    expect(document.querySelector('[data-testid="task-image-error"]')).toBeNull();
    const [mine] = images(taskId);
    expect(mine).toMatchObject({ name: 'layar-member.png', uploaded_by: member.id });
    const listed = (await (await serverApp.request(`/api/tasks/${taskId}/attachments`, { headers: { Cookie: member.cookie } })).json()) as {
      data: { attachments: Array<{ id: string; url: string }> };
    };
    const img = document.querySelector<HTMLImageElement>(`[data-image-id="${mine!.id}"] img`);
    expect(img?.getAttribute('src')).toBe(listed.data.attachments[0]!.url);

    // Another member's image has no delete button for this member.
    const ownerUpload = new TabFormData();
    ownerUpload.append('files', pngFile('layar-owner.png'));
    const encoded = await encodeMultipart(ownerUpload);
    const state = await issueCsrf(serverApp, owner.cookie);
    const uploaded = await serverApp.request(`/api/task-attachments?task_id=${taskId}`, {
      method: 'POST',
      headers: csrfHeaders(state, { 'Content-Type': encoded.contentType }),
      body: encoded.body,
    });
    expect(uploaded.status).toBe(201);
    await settle();
    const ownersImage = images(taskId).find((row) => row.name === 'layar-owner.png')!;
    expect(document.querySelector(`[data-image-id="${ownersImage.id}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-image-id="${ownersImage.id}"] .td__unshot`)).toBeNull();

    await press(`[data-image-id="${mine!.id}"] .td__unshot`);
    expect(images(taskId).map((row) => row.name)).toEqual(['layar-owner.png']);
    expect(document.querySelector(`[data-image-id="${mine!.id}"]`)).toBeNull();

    // The project owner may delete anyone's image.
    application?.unmount();
    application = undefined;
    await openTab(owner.cookie, `/projects/${projectId}/tasks/${taskId}`);
    await showDetailTab('Gambar');
    await press(`[data-image-id="${ownersImage.id}"] .td__unshot`);
    expect(images(taskId)).toEqual([]);
    expect(document.querySelector('.td__pane')?.textContent).toContain('Belum ada gambar.');
  });

  it('uploads the images picked in Task baru once the task exists, and names a wrong file before making it', async () => {
    const owner = await register('Ren Owner');
    const projectId = await createProject(owner);
    await openBatch(owner, projectId);
    await openTab(owner.cookie, `/projects/${projectId}/board`);

    await click('[data-testid="new-task"]');
    typeIn('#new-task-title', 'Logo baru di email');
    await chooseFiles('#new-task-images', [textFile('brief.txt')]);
    await submit('#new-task-form');
    expect(document.querySelector('#new-task-form')?.textContent).toContain('brief.txt: harus JPEG, PNG, GIF, atau WebP.');
    expect(db().prepare('SELECT 1 FROM tasks WHERE title = ?').get('Logo baru di email')).toBeUndefined();

    await press('#new-task-form .form__files .link');
    await chooseFiles('#new-task-images', [pngFile('logo.png')]);
    await submit('#new-task-form');
    expect(document.querySelector('#new-task-form')).toBeNull();
    const taskId = (db().prepare('SELECT id FROM tasks WHERE title = ?').get('Logo baru di email') as { id: string }).id;
    expect(images(taskId)).toMatchObject([{ name: 'logo.png', uploaded_by: owner.id }]);
    expect(document.body.textContent).not.toContain('belum terunggah');
  });
});

describe('the dashboard in the open tab', () => {
  const db = () => getDatabase();

  async function createProject(owner: { cookie: string }, name: string): Promise<string> {
    expect((await asDevice(owner.cookie, '/api/projects', 'POST', { name })).status).toBe(201);
    return (db().prepare('SELECT id FROM projects WHERE name = ? ORDER BY created_at DESC LIMIT 1').get(name) as { id: string }).id;
  }

  async function openBatch(owner: { cookie: string }, projectId: string): Promise<void> {
    expect((await asDevice(owner.cookie, `/api/projects/${projectId}/batches`, 'POST', { activate: true })).status).toBe(201);
  }

  async function createTask(actor: { cookie: string }, projectId: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
    expect((await asDevice(actor.cookie, `/api/projects/${projectId}/tasks`, 'POST', { title, ...extra })).status).toBe(201);
    return (db().prepare('SELECT id FROM tasks WHERE project_id = ? AND title = ?').get(projectId, title) as { id: string }).id;
  }

  async function move(actor: { cookie: string }, taskId: string, column: string): Promise<void> {
    expect((await asDevice(actor.cookie, `/api/tasks/${taskId}/move`, 'PATCH', { column_id: column, note: 'Catatan' })).status).toBe(200);
  }

  const stat = (index: number) => container.querySelectorAll('.stat')[index];
  const statValue = (index: number) => stat(index)?.querySelector('.stat__value')?.textContent?.trim();
  const statNote = (index: number) => stat(index)?.querySelector('.stat__note')?.textContent?.trim();

  it('shows the four stat blocks with their sub-lines and a board health row per project', async () => {
    const owner = await register('Ren Owner');
    const portal = await createProject(owner, 'Wajom Portal');
    await openBatch(owner, portal);
    const mine = await createTask(owner, portal, 'Pairing code', { assignee_id: owner.id });
    const twice = await createTask(owner, portal, 'Checkout Safari');
    const finished = await createTask(owner, portal, 'Status realtime');
    await move(owner, mine, 'ongoing');
    await move(owner, twice, 'revisi');
    await move(owner, twice, 'ongoing');
    await move(owner, twice, 'revisi');
    await move(owner, finished, 'done');
    const stoko = await createProject(owner, 'Stoko App');
    await createTask(owner, stoko, 'Katalog');

    await openTab(owner.cookie, '/dashboard');
    expect(container.querySelector('h1')?.textContent).toMatch(/, Ren$/);
    // Stoko only has a backlog task, so only Wajom Portal counts as a project with active tasks.
    expect(container.textContent).toContain('0 workspace, 1 project jalan.');
    expect([0, 1, 2, 3].map(statValue)).toEqual(['2', '1', '1', '1']);
    expect([0, 1, 2, 3].map(statNote)).toEqual([
      'di 1 project',
      '1 punya kamu',
      '1 balik lebih dari sekali',
      'naik 1 dari minggu lalu',
    ]);

    const portalRow = container.querySelector(`[data-project-id="${portal}"]`);
    expect(portalRow?.textContent).toContain('Wajom Portal');
    expect(portalRow?.querySelector('.health__ver')?.textContent).toBe('v0.1');
    expect(portalRow?.querySelector('.health__count')?.textContent).toBe('1/3');
    expect(portalRow?.querySelector('a')?.getAttribute('href')).toBe(`/projects/${portal}/board`);
    // No active batch: the row counts the whole project and shows no version.
    const stokoRow = container.querySelector(`[data-project-id="${stoko}"]`);
    expect(stokoRow?.querySelector('.health__ver')?.textContent).toBe('—');
    expect(stokoRow?.querySelector('.health__count')?.textContent).toBe('0/1');
  });

  it('lists recent activity by task title, status and version, links to the feed, and follows other devices live', async () => {
    const owner = await register('Ren Owner');
    const portal = await createProject(owner, 'Wajom Portal');
    await openBatch(owner, portal);
    const task = await createTask(owner, portal, 'Pairing code');
    await move(owner, task, 'revisi');

    await openTab(owner.cookie, '/dashboard');
    const latest = container.querySelector('.feed__list li');
    expect(latest?.textContent?.replace(/\s+/g, ' ')).toContain('Ren Owner mindahin Pairing code ke');
    expect(latest?.querySelector('b:nth-of-type(2)')?.textContent).toBe('Pairing code');
    expect(latest?.textContent).toContain('Revisi');
    expect(latest?.textContent).toContain('v0.1.2');
    expect(container.querySelector('.feed__all')?.getAttribute('href')).toBe('/feed');
    expect(statValue(2)).toBe('1');
    // Opening the batch reads "bump <project> ke batch" with the batch's version.
    const bumped = [...container.querySelectorAll('.feed__list li')].find((row) => row.textContent?.includes('bump'));
    expect(bumped?.textContent?.replace(/\s+/g, ' ')).toContain('Ren Owner bump Wajom Portal ke batch');
    expect(bumped?.querySelector('.act__ver')?.textContent).toBe('v0.1');

    // Another device finishes the task: the open dashboard refetches on the board topic.
    await move(owner, task, 'done');
    await settle();
    expect(statValue(2)).toBe('0');
    expect(statValue(3)).toBe('1');
    expect(container.querySelector('.feed__list li')?.textContent?.replace(/\s+/g, ' ')).toContain('nyelesaiin Pairing code');
  });

  it('counts a workspace made on another device and says in Indonesian why a new project was refused', async () => {
    const owner = await register('Ren Owner');
    await openTab(owner.cookie, '/dashboard');
    expect(container.textContent).toContain('0 workspace, 0 project jalan.');

    expect((await asDevice(owner.cookie, '/api/workspaces', 'POST', { name: 'Wajom Studio' })).status).toBe(201);
    await settle();
    expect(container.textContent).toContain('1 workspace, 0 project jalan.');

    await click('[data-testid="dashboard-new-project"]');
    const name = document.querySelector<HTMLInputElement>('#project-name')!;
    name.value = 'x'.repeat(256);
    name.dispatchEvent(new Event('input'));
    document.querySelector<HTMLFormElement>('#new-project-form')!.requestSubmit();
    await settle();
    expect(document.querySelector('#new-project-form')?.textContent).toContain('Nama wajib diisi, maksimal 255 karakter.');
    expect(db().prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?').get(owner.id)).toEqual({ n: 0 });
  });
});
