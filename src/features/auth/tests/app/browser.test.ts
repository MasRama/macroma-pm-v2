/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../../app/App.vue';
import router from '../../../../app/router';
import { app as serverApp } from '../../../../app/server';
import { getDatabase } from '../../../../shared/database';
import { csrfHeaders, issueCsrf, mergeResponseCookies } from '../../../../shared/security/tests/helpers';
import { createAuthClient, createAuthSession, useAuthSession, type AuthClient, type CurrentUser } from '../../web';
import { createSecurityClient } from '../../web/security-client';
import { GOOGLE_SIGN_IN_PATH } from '../../web';
import { GOOGLE } from '../../server/config';
import { useMailTransport, type MailMessage } from '../../server/mail';
import { totpCode, totpStep } from '../../server/totp';
import { startGoogleSignIn } from '../../../../app/pages/auth/google';

const TEST_PASSWORD = 'correct horse battery staple';

let container: HTMLDivElement;
let application: { unmount(): void } | undefined;
let cookieJar: Map<string, string>;
let fetchPaths: string[];
let pendingFetches: Set<Promise<Response>>;

function syncDocumentCookies(): void {
  for (const [name, value] of cookieJar) document.cookie = `${name}=${value}`;
}

function adoptCookieString(cookieString: string): void {
  for (const part of cookieString.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    cookieJar.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  syncDocumentCookies();
}

function storeResponseCookies(response: Response): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];
  for (const header of setCookies) {
    const pair = (header.split(';', 1)[0] ?? '').trim();
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value.length === 0) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
  syncDocumentCookies();
}

function cookieHeader(): string | undefined {
  if (cookieJar.size === 0) return undefined;
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function setSessionCookie(value: string | undefined): void {
  if (value === undefined) {
    cookieJar.delete('auth_id');
    document.cookie = 'auth_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  } else {
    cookieJar.set('auth_id', value);
    document.cookie = `auth_id=${value}`;
  }
}
function installApiFetch(): void {
  const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(inputUrl, 'http://nara.test');
    fetchPaths.push(url.pathname);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init?.headers)) {
      headers.set(name, value);
    }
    const jar = cookieHeader();
    if (jar) headers.set('Cookie', jar);

    const response = await serverApp.request(url.pathname + url.search, {
      method: init?.method,
      headers,
      body: init?.body,
    });
    storeResponseCookies(response);
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      json: async () => JSON.parse(body),
      text: async () => body,
    } as Response;
  };

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = request(input, init);
    pendingFetches.add(response);
    void response.finally(() => pendingFetches.delete(response));
    return response;
  });
}

async function registerDirect(email: string): Promise<void> {
  const state = await issueCsrf(serverApp);
  adoptCookieString(state.cookie);
  const response = await serverApp.request('/api/auth/register', {
    method: 'POST',
    headers: { ...csrfHeaders(state), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Existing User', email, password: TEST_PASSWORD }),
  });
  expect(response.status).toBe(201);
  adoptCookieString(mergeResponseCookies(state.cookie, response));
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (pendingFetches.size > 0) {
      await Promise.all([...pendingFetches]);
    }
    await Promise.resolve();
    await nextTick();
  }
}
function waitForNavigation(): Promise<void> {
  return new Promise((resolve) => {
    const removeHook = router.afterEach(() => {
      removeHook();
      resolve();
    });
  });
}

async function mountAt(path: string): Promise<void> {
  await router.push(path);
  await router.isReady();
  const mountedApplication = createApp(App).use(router);
  mountedApplication.mount(container);
  application = mountedApplication;
  await nextTick();
}

function setInput(selector: string, value: string): void {
  const input = container.querySelector(selector);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitForm(): void {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Missing auth form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  application = undefined;
  cookieJar = new Map();
  document.cookie = 'auth_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  fetchPaths = [];
  pendingFetches = new Set();
  installApiFetch();

  await useAuthSession().logout();
  await router.push('/');
  await router.isReady();
  // "/" redirects to the signed-in dashboard, so parking the router already
  // asks /api/auth/me; each test counts only the requests it makes itself.
  fetchPaths = [];
});

afterEach(async () => {
  application?.unmount();
  application = undefined;
  await useAuthSession().logout();
  await router.push('/');
  container.remove();
  vi.unstubAllGlobals();
});

describe('browser authentication lifecycle', () => {
  it('navigates from login to registration and registers without a document reload', async () => {
    await mountAt('/login');
    const documentElement = document.documentElement;
    const registerLink = container.querySelector<HTMLAnchorElement>('a[href="/register"]');
    expect(registerLink).not.toBeNull();
    const registerNavigation = waitForNavigation();
    registerLink?.click();
    await registerNavigation;

    expect(router.currentRoute.value.name).toBe('register');
    expect(container.querySelector('.af-title')?.textContent).toBe('Daftar');

    const email = `register-${Date.now()}@example.com`;
    setInput('#register-name', 'Ada Lovelace');
    setInput('#register-email', email);
    setInput('#register-password', TEST_PASSWORD);
    const dashboardNavigation = waitForNavigation();
    submitForm();
    await nextTick();
    const registrationButton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(registrationButton?.disabled).toBe(true);
    expect(registrationButton?.textContent).toContain('Membuat akun…');
    await dashboardNavigation;

    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(container.querySelector('h1')?.textContent).toMatch(/, Ada$/);
    expect(document.documentElement).toBe(documentElement);
    expect(useAuthSession().user.value?.email).toBe(email);
    expect(fetchPaths).toContain('/api/auth/register');

    const currentUserResponse = await serverApp.request('/api/auth/me', {
      headers: { Cookie: cookieHeader()! },
    });
    expect(currentUserResponse.status).toBe(200);
  });

  it('renders registration validation errors without sending invalid input', async () => {
    await mountAt('/register');

    setInput('#register-name', ' ');
    setInput('#register-email', 'invalid');
    setInput('#register-password', 'short');
    submitForm();
    await settle();

    expect(router.currentRoute.value.name).toBe('register');
    expect(container.textContent).toContain('Nama wajib diisi');
    expect(container.textContent).toContain('Masukkan email yang valid');
    expect(container.textContent).toContain('Password minimal 8 karakter');
    expect(fetchPaths.filter((path) => path === '/api/auth/register')).toHaveLength(0);
  });

  it('renders a server registration failure', async () => {
    const email = `duplicate-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().logout();
    await mountAt('/register');

    setInput('#register-name', 'Another User');
    setInput('#register-email', email);
    setInput('#register-password', TEST_PASSWORD);
    submitForm();
    await settle();

    expect(router.currentRoute.value.name).toBe('register');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Email already in use');
  });

  it('renders login errors and loading state', async () => {
    const email = `login-error-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().logout();
    await mountAt('/login');

    setInput('#login-email', email);
    setInput('#login-password', 'wrong password');
    submitForm();

    await nextTick();
    const loginErrorButton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(loginErrorButton?.disabled).toBe(true);
    expect(loginErrorButton?.textContent).toContain('Masuk…');
    await settle();

    expect(router.currentRoute.value.name).toBe('login');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid email or password');
    expect(useAuthSession().status.value).toBe('unauthenticated');
  });

  it('bootstraps an existing session once and resolves missing or expired sessions as guests', async () => {
    const email = `bootstrap-${Date.now()}@example.com`;
    await registerDirect(email);
    const session = createAuthSession();

    await Promise.all([session.load(), session.load()]);

    expect(session.status.value).toBe('authenticated');
    expect(session.user.value?.email).toBe(email);
    expect(fetchPaths.filter((path) => path === '/api/auth/me')).toHaveLength(1);

    setSessionCookie(undefined);
    const missingSession = createAuthSession();
    await missingSession.load();
    expect(missingSession.status.value).toBe('unauthenticated');

    setSessionCookie('expired-session');
    const expiredSession = createAuthSession();
    await expiredSession.load();
    expect(expiredSession.status.value).toBe('unauthenticated');
  });

  it('preserves established auth state across transient current-user failures and clears it only on unauthorized', async () => {
    const user: CurrentUser = {
      id: 'session-user',
      name: 'Session User',
      email: 'session@example.com',
      avatar: null,
      phone: null,
      verified: false,
      roles: ['admin'],
      permissions: ['users.view'],
      mustChangePassword: false,
    };
    const me = vi
      .fn()
      .mockResolvedValueOnce({ success: true, message: 'OK', data: { user } })
      .mockResolvedValueOnce({ success: false, message: 'Server unavailable', code: 'INTERNAL_ERROR' })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ success: false, message: 'Unauthorized', code: 'UNAUTHORIZED' });
    const session = createAuthSession({ me } as unknown as AuthClient);

    await session.load();
    expect(session.isAuthenticated.value).toBe(true);

    await expect(session.refresh()).rejects.toThrow('Server unavailable');
    expect(session.isAuthenticated.value).toBe(true);
    expect(session.user.value).toEqual(user);

    await expect(session.refresh()).rejects.toThrow('network unavailable');
    expect(session.isAuthenticated.value).toBe(true);
    expect(session.user.value).toEqual(user);

    await expect(session.refresh()).resolves.toBe(false);
    expect(session.status.value).toBe('unauthenticated');
    expect(session.user.value).toBeNull();
  });

  it('revalidates an established session before protected navigation and redirects when it was revoked', async () => {
    const email = `revoked-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().refresh();
    await mountAt('/dashboard');
    expect(useAuthSession().isAuthenticated.value).toBe(true);

    setSessionCookie(undefined);
    await router.push('/profile');
    await router.isReady();

    expect(useAuthSession().status.value).toBe('unauthenticated');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/profile');
  });

  it('redirects guests to login and returns them to the protected destination after login', async () => {
    const email = `login-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().logout();

    await mountAt('/dashboard');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard');

    const documentElement = document.documentElement;
    setInput('#login-email', email);
    setInput('#login-password', TEST_PASSWORD);
    const navigation = waitForNavigation();
    submitForm();
    await nextTick();
    const loginButton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(loginButton?.disabled).toBe(true);
    expect(loginButton?.textContent).toContain('Masuk…');
    await navigation;

    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(container.querySelector('h1')?.textContent).toMatch(/, Existing$/);
    expect(useAuthSession().isAuthenticated.value).toBe(true);
    expect(document.documentElement).toBe(documentElement);
  });

  it('asks for an authenticator code after the password when two-factor is on', async () => {
    const email = `two-factor-${Date.now()}@example.com`;
    await registerDirect(email);
    const security = createSecurityClient();
    const setup = await security.startTwoFactorSetup({ password: TEST_PASSWORD });
    const secret = setup.success ? setup.data!.secret : '';
    expect((await security.enableTwoFactor({ code: totpCode(secret, totpStep()) })).success).toBe(true);
    await useAuthSession().logout();

    await mountAt('/login');
    setInput('#login-email', email);
    setInput('#login-password', TEST_PASSWORD);
    submitForm();
    await settle();
    expect(container.querySelector('[data-testid="two-factor-form"]')).not.toBeNull();
    expect(useAuthSession().isAuthenticated.value).toBe(false);

    setInput('#login-code', '000000');
    submitForm();
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid authentication code');

    const navigation = waitForNavigation();
    setInput('#login-code', totpCode(secret, totpStep() + 1));
    submitForm();
    await navigation;
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(useAuthSession().isAuthenticated.value).toBe(true);
  });

  it('enrolls two-factor from the security page and shows the current device', async () => {
    const email = `security-page-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().refresh();
    await mountAt('/security');
    await settle();

    const sessionRows = container.querySelectorAll('[data-testid="session-row"]');
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.textContent).toContain('This device');

    [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Set up two-factor'))!.click();
    await nextTick();
    setInput('#security-password', TEST_PASSWORD);
    container.querySelector<HTMLFormElement>('[data-testid="confirm-password-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(container.querySelector('[data-testid="two-factor-setup"] svg path')?.getAttribute('d')).toMatch(/^M\d/);
    const secret = container.querySelector('[data-testid="two-factor-secret"]')!.textContent!.replace(/\s/g, '');
    setInput('#two-factor-enable-code', totpCode(secret, totpStep()));
    container.querySelector<HTMLFormElement>('[data-testid="two-factor-setup"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    expect(container.querySelectorAll('[data-testid="recovery-codes"] li')).toHaveLength(10);
    expect(container.querySelector('[data-testid="two-factor-panel"]')?.textContent).toContain('10 recovery codes left');
  });

  it('forces temporary-password users through password change before dashboard access', async () => {
    const email = `temporary-${Date.now()}@example.com`;
    const replacement = 'replacement browser password';
    await registerDirect(email);
    getDatabase().prepare('UPDATE users SET must_change_password = 1 WHERE email = ?').run(email);
    await useAuthSession().logout();

    await mountAt('/login');
    setInput('#login-email', email);
    setInput('#login-password', TEST_PASSWORD);
    const forcedNavigation = waitForNavigation();
    submitForm();
    await forcedNavigation;
    await settle();

    expect(router.currentRoute.value.name).toBe('change-password');
    expect(container.querySelector('h1')?.textContent).toContain('Change your password');
    expect(container.querySelector('.nara-auth')).not.toBeNull();
    expect(container.querySelector('[aria-label="Application navigation"]')).toBeNull();
    expect(container.querySelector('a[href="/"]')).toBeNull();
    expect(useAuthSession().user.value?.mustChangePassword).toBe(true);

    setInput('#current-password', TEST_PASSWORD);
    setInput('#new-password', replacement);
    setInput('#confirm-password', replacement);
    const dashboardNavigation = waitForNavigation();
    submitForm();
    await dashboardNavigation;
    await settle();

    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(useAuthSession().user.value?.mustChangePassword).toBe(false);
    expect(fetchPaths).toContain('/api/auth/change-password');
  });

  it('logs out through the server and protects the route again', async () => {
    const email = `logout-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().refresh();
    await mountAt('/dashboard');

    const logoutButton = container.querySelector<HTMLButtonElement>('button[aria-label="Keluar"]');
    expect(logoutButton).not.toBeNull();
    const navigation = waitForNavigation();
    logoutButton?.click();
    await navigation;

    expect(router.currentRoute.value.name).toBe('login');
    expect(useAuthSession().status.value).toBe('unauthenticated');
    const currentUserResponse = await serverApp.request('/api/auth/me', {
      headers: { Cookie: cookieHeader() ?? '' },
    });
    expect(currentUserResponse.status).toBe(401);

    await router.push('/dashboard');
    await router.isReady();
    expect(router.currentRoute.value.name).toBe('login');
  });
});

// An application may replace Auth's pages with its own: everything a sign-in
// page needs comes from the Auth web boundary, so the replacement imports
// nothing private and Auth stays evolvable underneath it.
describe('application-owned auth pages', () => {
  it('signs in through a page built only on createAuthClient and useAuthSession', async () => {
    const email = `own-page-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().logout();

    const OwnSignIn = defineComponent(() => {
      const client = createAuthClient();
      const session = useAuthSession();
      const message = ref('');
      async function submit(event: Event) {
        event.preventDefault();
        const result = await client.login({ email, password: TEST_PASSWORD });
        if (!result.success) message.value = result.message;
        else await session.refresh();
      }
      return () =>
        h('form', { onSubmit: submit }, [
          h('p', { role: 'status' }, session.isAuthenticated.value ? `Signed in as ${session.user.value?.email}` : message.value),
          h('button', { type: 'submit' }, 'Sign in'),
        ]);
    });
    const mounted = createApp(OwnSignIn);
    mounted.mount(container);
    application = mounted;

    submitForm();
    await settle();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(`Signed in as ${email}`);
    expect(useAuthSession().isAuthenticated.value).toBe(true);
  });

  it('offers no registration link when the application routes no register page', async () => {
    const register = router.getRoutes().find((route) => route.name === 'register')!;
    router.removeRoute('register');
    try {
      await mountAt('/login');
      expect(container.querySelector('a[href="/register"]')).toBeNull();
      expect(container.querySelector('form')).not.toBeNull();
    } finally {
      router.addRoute(register);
    }
  });
});

describe('Macroma sign-in pages on the Auth API', () => {
  function click(selector: string): void {
    const element = container.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    element.click();
  }

  /** Serves Google's token and profile endpoints for the server's own calls; everything else goes to the app. */
  function stubGoogle(account: { email: string; name: string }): void {
    const delegated = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return Promise.resolve(Response.json({ access_token: 'google-token' }));
      if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
        return Promise.resolve(Response.json({ ...account, verified_email: true }));
      }
      return delegated(input, init);
    });
  }

  const googleSettings = { ...GOOGLE };
  afterEach(() => {
    Object.assign(GOOGLE, googleSettings);
    useMailTransport(undefined);
  });

  it('registers with an optional phone number and checks its format first', async () => {
    await mountAt('/register');
    const email = `phone-${Date.now()}@example.com`;
    setInput('#register-name', 'Phone Person');
    setInput('#register-email', email);
    setInput('#register-phone', 'call me');
    setInput('#register-password', TEST_PASSWORD);
    submitForm();
    await settle();
    expect(container.textContent).toContain('Nomor HP hanya boleh angka');
    expect(fetchPaths).not.toContain('/api/auth/register');

    setInput('#register-phone', '+62 812-3456-7890');
    const navigation = waitForNavigation();
    submitForm();
    await navigation;
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(getDatabase().prepare('SELECT phone, verified FROM users WHERE email = ?').get(email)).toEqual({
      phone: '+62 812-3456-7890',
      verified: 0,
    });
  });

  it('says so on the page when the server has no Google sign-in', async () => {
    Object.assign(GOOGLE, { clientId: undefined, clientSecret: undefined, redirectUri: undefined });
    await mountAt('/login');
    click('[data-testid="google-sign-in"]');
    await settle();

    expect(fetchPaths).toContain(GOOGLE_SIGN_IN_PATH);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Masuk dengan Google belum diaktifkan');
    expect(container.textContent).not.toContain('belum tersedia');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="google-sign-in"]')?.disabled).toBe(false);
  });

  it('sends the browser to Google when the server is set up for it', async () => {
    Object.assign(GOOGLE, { clientId: 'client', clientSecret: 'secret', redirectUri: 'http://nara.test/api/auth/google/callback' });
    // jsdom cannot leave the page, so the navigation is observed instead.
    const navigate = vi.fn();
    await expect(startGoogleSignIn(navigate)).resolves.toBe('');
    expect(navigate).toHaveBeenCalledWith(GOOGLE_SIGN_IN_PATH);
    expect(fetchPaths).toContain(GOOGLE_SIGN_IN_PATH);
  });

  it('asks for the second factor when Google returns a two-factor account to Masuk', async () => {
    const email = `google-two-factor-${Date.now()}@example.com`;
    await registerDirect(email);
    getDatabase().prepare('UPDATE users SET verified = 1 WHERE email = ?').run(email);
    const security = createSecurityClient();
    const setup = await security.startTwoFactorSetup({ password: TEST_PASSWORD });
    const secret = setup.success ? setup.data!.secret : '';
    expect((await security.enableTwoFactor({ code: totpCode(secret, totpStep()) })).success).toBe(true);
    await useAuthSession().logout();

    Object.assign(GOOGLE, { clientId: 'client', clientSecret: 'secret', redirectUri: 'http://nara.test/api/auth/google/callback' });
    stubGoogle({ email, name: 'Existing User' });
    const start = await serverApp.request(GOOGLE_SIGN_IN_PATH);
    expect(start.status).toBe(302);
    storeResponseCookies(start);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const callback = await serverApp.request(`/api/auth/google/callback?code=google-code&state=${state}`, {
      headers: { Cookie: cookieHeader()! },
    });
    expect(callback.headers.get('location')).toBe('/login?two-factor=1');
    storeResponseCookies(callback);

    await mountAt('/login?two-factor=1');
    expect(container.querySelector('[data-testid="two-factor-form"]')).not.toBeNull();
    const navigation = waitForNavigation();
    setInput('#login-code', totpCode(secret, totpStep() + 1));
    submitForm();
    await navigation;
    expect(router.currentRoute.value.name).toBe('dashboard');
    expect(useAuthSession().user.value?.email).toBe(email);
  });

  it('explains why Google sent the person back to Masuk', async () => {
    await mountAt('/login?google-error=registration-closed');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Pendaftaran akun baru sedang ditutup');

    application?.unmount();
    await mountAt('/login?google-error=not-a-reason');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('mails a reset link from Lupa password and sets the new password from it', async () => {
    const sent: MailMessage[] = [];
    useMailTransport({ send: async (message) => void sent.push(message) });
    const email = `reset-${Date.now()}@example.com`;
    await registerDirect(email);
    await useAuthSession().logout();

    await mountAt('/forgot-password');
    setInput('#forgot-email', email);
    submitForm();
    await settle();
    await new Promise((resolve) => setImmediate(resolve));
    expect(container.querySelector('[data-testid="forgot-sent"]')?.textContent).toContain(email);
    expect(sent).toHaveLength(1);
    const token = sent[0]!.text.match(/reset-password\?token=([a-f0-9]+)/)?.[1];
    if (!token) throw new Error('No reset link in the email');

    application?.unmount();
    await mountAt(`/reset-password?token=${token}`);
    setInput('#reset-password', 'a brand new passphrase');
    setInput('#reset-confirmation', 'a brand new passphrase');
    const navigation = waitForNavigation();
    submitForm();
    await navigation;
    await settle();
    expect(router.currentRoute.value.name).toBe('login');
    expect(container.querySelector('[data-testid="reset-done"]')).not.toBeNull();

    const csrf = await issueCsrf(serverApp);
    const login = await serverApp.request('/api/auth/login', {
      method: 'POST',
      headers: { ...csrfHeaders(csrf), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'a brand new passphrase' }),
    });
    expect(login.status).toBe(200);

    // The link works once.
    application?.unmount();
    await mountAt(`/reset-password?token=${token}`);
    setInput('#reset-password', 'yet another passphrase');
    setInput('#reset-confirmation', 'yet another passphrase');
    submitForm();
    await settle();
    expect(container.querySelector('[data-testid="reset-link-invalid"]')).not.toBeNull();
  });

  it('offers a new link when Reset password opens without a token', async () => {
    await mountAt('/reset-password');
    expect(container.querySelector('[data-testid="reset-link-invalid"]')).not.toBeNull();
    expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  });

  it('shows a clear message when the server cannot send reset email', async () => {
    const delegated = globalThis.fetch;
    // A production server without MAIL_HOST answers this (see password-reset.test.ts).
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/auth/forgot-password')) {
        const body = { success: false, message: 'Password reset by email is not available.', code: 'MAIL_DISABLED' };
        return Promise.resolve(Response.json(body, { status: 503 }));
      }
      return delegated(input, init);
    });
    await mountAt('/forgot-password');
    setInput('#forgot-email', 'someone@example.com');
    submitForm();
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reset password lewat email belum aktif di server ini');
    expect(container.querySelector('[data-testid="forgot-sent"]')).toBeNull();
  });
});
