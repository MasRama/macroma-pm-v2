// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokensPage from '../pages/TokensPage.vue';
import { AUTH_TOKENS_CHANGED_EVENT, type ApiTokenData, type SecurityClient } from '../../features/auth/web';
import { connectServerEvents, disconnectServerEvents } from '../../shared/realtime/browser';

/**
 * The Token API page against a stand-in security client: what it lists, the
 * secret it shows once, revoking, the Indonesian text per refusal, and the
 * refetch a live `auth.tokens-changed` event triggers.
 */
type TokensClient = Pick<SecurityClient, 'listTokens' | 'createToken' | 'revokeToken' | 'revokeAllTokens'>;

const NOW = new Date('2026-11-17T10:20:00').getTime();
const DAY = 86_400_000;
const SECRET = 'mcr_Vx8pQ2nT4kLw9sRb7HcJ3mZd6FyA1uGe5XqP0oVi';

/** A GET /api/auth/tokens row. */
function row(overrides: Partial<ApiTokenData> & Pick<ApiTokenData, 'id' | 'name'>): ApiTokenData {
  return {
    prefix: `mcr_${overrides.id.padEnd(6, 'x')}`,
    scope: 'read',
    createdAt: NOW - 3 * DAY,
    expiresAt: NOW + 27 * DAY,
    lastUsedAt: null,
    expired: false,
    ...overrides,
  };
}

const deploy = row({ id: 'k2', name: 'Script deploy', scope: 'write', lastUsedAt: NOW - 2 * 3_600_000 });
const weekly = row({ id: 'k1', name: 'Laporan mingguan', expiresAt: null });
const old = row({ id: 'k0', name: 'CI lama', scope: 'write', createdAt: NOW - 120 * DAY, expiresAt: NOW - 17 * DAY, expired: true });

const ok = <T>(data: T) => ({ success: true as const, message: 'OK', data });
const refusal = (code: string, errors?: Record<string, string[]>) =>
  ({ success: false as const, message: 'Refused', code, ...(errors ? { errors } : {}) }) as never;

function fakeClient(tokens: ApiTokenData[] = [deploy, weekly, old]) {
  return {
    listTokens: vi.fn(async () => ok({ tokens })),
    createToken: vi.fn(async (input: { name: string }) => ({
      ...ok({ token: row({ id: 'k9', name: input.name, scope: 'read' }), secret: SECRET }),
    })),
    revokeToken: vi.fn(async () => ok({ revoked: 1 })),
    revokeAllTokens: vi.fn(async () => ok({ revoked: tokens.length })),
  } satisfies TokensClient;
}

let app: App | undefined;
let host: HTMLElement | undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

async function mount(client: TokensClient): Promise<HTMLElement> {
  const topbar = document.createElement('div');
  topbar.id = 'shell-topbar';
  host = document.createElement('div');
  document.body.append(topbar, host);
  app = createApp(TokensPage, { client });
  app.mount(host);
  await settle();
  return host;
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="token-row"]')];
const text = () => document.body.textContent ?? '';
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!;
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
function button(label: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}
async function typeName(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#token-name')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await nextTick();
}
async function submit(): Promise<void> {
  byTestId('token-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  app = undefined;
  host = undefined;
  disconnectServerEvents();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Token API list', () => {
  it('shows each token by name, prefix, scope, dates and expired state, never a secret', async () => {
    await mount(fakeClient());

    expect(rows().map((element) => element.dataset.tokenId)).toEqual(['k2', 'k1', 'k0']);
    const [first, second, third] = rows().map((element) => element.textContent ?? '');
    expect(first).toContain('Script deploy');
    expect(first).toContain('Baca + tulis');
    expect(first).toContain('mcr_k2xxxx…');
    expect(first).toContain('Dibuat 14 Nov 2026');
    expect(first).toContain('Berlaku sampai 14 Des 2026');
    expect(first).toContain('Terakhir dipakai 2 jam lalu');
    expect(second).toContain('Baca');
    expect(second).toContain('Tidak pernah kedaluwarsa');
    expect(second).toContain('Belum pernah dipakai');
    expect(third).toContain('Kedaluwarsa 31 Okt 2026');
    expect(rows()[2]!.classList.contains('row--expired')).toBe(true);
    expect(byTestId('token-count')?.textContent).toBe('3');
    expect(byTestId('new-secret')).toBeNull();
    expect(byTestId('password-note')?.textContent).toBe('Ganti atau reset password akan mencabut semua token.');
  });

  it('shows the empty state and no Cabut semua when the account has no token', async () => {
    await mount(fakeClient([]));

    expect(byTestId('tokens-empty')?.textContent).toContain('Belum ada token');
    expect(byTestId('revoke-all')).toBeNull();
    expect(byTestId('password-note')).not.toBeNull();
  });

  it('says in Indonesian why the list could not load', async () => {
    const client = fakeClient();
    client.listTokens.mockResolvedValueOnce(refusal('UNAUTHORIZED'));
    await mount(client);

    expect(byTestId('load-error')?.textContent).toBe('Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.');
  });
});

describe('creating a token', () => {
  it('sends the name, expiry and scope, then shows the secret once with a copy button', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const client = fakeClient();
    await mount(client);

    await typeName('  Integrasi Slack ');
    const expiry = document.querySelector<HTMLSelectElement>('#token-expiry')!;
    expect([...expiry.options].at(-1)?.textContent?.trim()).toBe('Tidak pernah');
    expect(byTestId('never-expires-warning')).toBeNull();
    expiry.value = 'never';
    expiry.dispatchEvent(new Event('change'));
    await nextTick();
    expect(byTestId('never-expires-warning')?.textContent).toContain('aktif terus sampai kamu mencabutnya');
    button('Baca + tulis').click();
    await submit();

    expect(client.createToken).toHaveBeenCalledWith({ name: 'Integrasi Slack', scope: 'write', expiresInDays: null });
    expect(byTestId('secret-value')?.textContent).toBe(SECRET);
    expect(byTestId('new-secret')?.textContent).toContain('tidak bisa dilihat lagi');
    expect(rows()[0]!.dataset.tokenId).toBe('k9');
    expect(rows()[0]!.textContent).not.toContain(SECRET);
    expect((document.querySelector<HTMLInputElement>('#token-name')!).value).toBe('');

    byTestId('copy-secret')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(byTestId('copy-secret')?.textContent?.trim()).toBe('Tersalin');

    byTestId('close-secret')!.click();
    await settle();
    expect(byTestId('new-secret')).toBeNull();
    expect(text()).not.toContain(SECRET);
  });

  it('defaults to 90 days and read access, with no never-expires warning', async () => {
    const client = fakeClient();
    await mount(client);
    expect(document.querySelector<HTMLSelectElement>('#token-expiry')!.value).toBe('90');
    expect(byTestId('never-expires-warning')).toBeNull();

    await typeName('Zapier');
    await submit();

    expect(client.createToken).toHaveBeenCalledWith({ name: 'Zapier', scope: 'read', expiresInDays: 90 });
  });

  it('asks for a name before calling the API', async () => {
    const client = fakeClient();
    await mount(client);

    await typeName('   ');
    await submit();

    expect(client.createToken).not.toHaveBeenCalled();
    expect(text()).toContain('Nama token wajib diisi, maksimal 80 karakter.');
  });

  it('says the token limit is reached on 409 TOKEN_LIMIT_REACHED', async () => {
    const client = fakeClient();
    client.createToken.mockResolvedValueOnce(refusal('TOKEN_LIMIT_REACHED'));
    await mount(client);

    await typeName('Satu lagi');
    await submit();

    expect(text()).toContain('Token API kamu sudah mencapai batas. Cabut salah satu dulu.');
    expect(byTestId('new-secret')).toBeNull();
  });

  it('words each field the API refused on 422 VALIDATION_ERROR', async () => {
    const client = fakeClient();
    client.createToken.mockResolvedValueOnce(
      refusal('VALIDATION_ERROR', { name: ['Token name must be at most 80 characters'], expiresInDays: ['Expiry is 1 to 365 days'] }),
    );
    await mount(client);

    await typeName('Nama');
    await submit();

    expect(text()).toContain('Ada isian yang belum pas. Cek lagi ya.');
    expect(text()).toContain('Nama token wajib diisi, maksimal 80 karakter.');
    expect(text()).toContain('Masa berlaku 1–365 hari, atau tanpa batas.');
  });
});

describe('revoking tokens', () => {
  it('revokes one token after the confirm dialog', async () => {
    const client = fakeClient();
    await mount(client);

    byTestId('revoke-k2')!.click();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')?.getAttribute('aria-label')).toBe('Cabut token Script deploy?');
    button('Cabut token', dialog()).click();
    await settle();

    expect(client.revokeToken).toHaveBeenCalledWith('k2');
    expect(rows().map((element) => element.dataset.tokenId)).toEqual(['k1', 'k0']);
    expect(text()).toContain('Token Script deploy dicabut.');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('keeps the token when the dialog is cancelled', async () => {
    const client = fakeClient();
    await mount(client);

    byTestId('revoke-k1')!.click();
    await settle();
    button('Batal', dialog()).click();
    await settle();

    expect(client.revokeToken).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(3);
  });

  it('says the token is gone on 404 and reloads the list', async () => {
    const client = fakeClient();
    client.revokeToken.mockResolvedValueOnce(refusal('NOT_FOUND'));
    await mount(client);
    client.listTokens.mockResolvedValueOnce(ok({ tokens: [weekly, old] }));

    byTestId('revoke-k2')!.click();
    await settle();
    button('Cabut token', dialog()).click();
    await settle();

    expect(text()).toContain('Token ini sudah dicabut atau tidak ada lagi.');
    expect(client.listTokens).toHaveBeenCalledTimes(2);
    expect(rows().map((element) => element.dataset.tokenId)).toEqual(['k1', 'k0']);
  });

  it('revokes every token after the confirm dialog and shows the empty state', async () => {
    const client = fakeClient();
    await mount(client);

    byTestId('revoke-all')!.click();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Semua 3 token langsung berhenti bekerja');
    button('Cabut semua', dialog()).click();
    await settle();

    expect(client.revokeAllTokens).toHaveBeenCalledOnce();
    expect(text()).toContain('3 token dicabut.');
    expect(byTestId('tokens-empty')).not.toBeNull();
  });
});

describe('live updates', () => {
  it('refetches the list when auth.tokens-changed arrives', async () => {
    const sources: EventTarget[] = [];
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readyState = 1;
      constructor() {
        super();
        sources.push(this);
      }
      close(): void {
        this.readyState = 2;
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = fakeClient();
    await mount(client);
    connectServerEvents();
    client.listTokens.mockResolvedValueOnce(ok({ tokens: [weekly] }));

    sources[0]!.dispatchEvent(new Event(AUTH_TOKENS_CHANGED_EVENT));
    await settle();

    expect(client.listTokens).toHaveBeenCalledTimes(2);
    expect(rows().map((element) => element.dataset.tokenId)).toEqual(['k1']);
  });
});
