import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/app/App.vue';
import AppFrame from '../../src/app/layouts/AppFrame.vue';
import router from '../../src/app/router';
import { initializeTheme, setTheme, THEME_STORAGE_KEY } from '../../src/app/theme';

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('Macroma frontend shell', () => {
  let container: HTMLDivElement;
  let app: ReturnType<typeof createApp> | undefined;
  let prefersDark = false;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    window.localStorage.clear();
    prefersDark = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: prefersDark, addEventListener: vi.fn() })),
    });
    // Nobody is signed in: the session endpoint refuses, so protected routes go to Masuk.
    vi.stubGlobal('fetch', async () =>
      Response.json({ success: false, message: 'Authentication required.', code: 'UNAUTHORIZED' }, { status: 401 }),
    );
    await router.push('/login');
  });

  afterEach(async () => {
    app?.unmount();
    app = undefined;
    vi.unstubAllGlobals();
    container.remove();
    document.documentElement.classList.remove('dark');
  });

  async function mountAt(path: string): Promise<void> {
    await router.push(path);
    await router.isReady();
    app = createApp(App).use(router);
    app.mount(container);
    await nextTick();
  }

  it('sends a signed-out visitor from / to Masuk, remembering the dashboard', async () => {
    await mountAt('/');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard');
    expect(container.querySelector('.af-title')?.textContent).toBe('Masuk');
    expect(container.querySelector('form')).not.toBeNull();
  });

  it('shows the version story beside the sign-in form and switches to Daftar without a reload', async () => {
    await mountAt('/login');
    const documentElement = document.documentElement;

    expect(container.querySelector('.auth__story h1')?.textContent).toContain('Kanban yang');
    container.querySelector<HTMLAnchorElement>('a[href="/register"]')?.click();
    await flush();
    await nextTick();

    expect(router.currentRoute.value.name).toBe('register');
    expect(container.querySelector('.af-title')?.textContent).toBe('Daftar');
    expect(document.documentElement).toBe(documentElement);
  });

  it('renders the Macroma 404 for unknown browser routes', async () => {
    await mountAt('/this-route-does-not-exist');

    expect(container.querySelector('[data-testid="not-found-page"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toContain('Halaman tidak ditemukan');
  });
});

describe('Macroma phone menu', () => {
  it('opens from the menu button and closes on Escape', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const memory = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] });
    await memory.push('/');
    const user = { id: 1, name: 'Ren', caption: 'Owner' };
    const frame = createApp({ render: () => h(AppFrame, { user }) }).use(memory);
    frame.mount(container);
    await nextTick();

    const side = container.querySelector('.shell__side')!;
    container.querySelector<HTMLButtonElement>('button[aria-label="Buka menu"]')!.click();
    await nextTick();
    expect(side.classList.contains('shell__side--open')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(side.classList.contains('shell__side--open')).toBe(false);
    expect(container.querySelector('.shell__scrim')).toBeNull();

    frame.unmount();
    container.remove();
  });
});

describe('Macroma theme switch', () => {
  let prefersDark = false;

  beforeEach(() => {
    window.localStorage.clear();
    prefersDark = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: prefersDark, addEventListener: vi.fn() })),
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('keeps Terang and Gelap per browser and follows the system otherwise', () => {
    setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    prefersDark = true;
    setTheme('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies a saved choice on start', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initializeTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Macroma design tokens', () => {
  it('self-hosts Geist through npm instead of a font CDN', () => {
    const entry = readFileSync('resources/app.ts', 'utf8');
    expect(entry).toContain("import '@fontsource-variable/geist';");
    expect(entry).toContain("import '@fontsource-variable/geist-mono';");
    expect(readFileSync('resources/index.html', 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(readFileSync('resources/macroma.css', 'utf8')).toMatch(/--font-ui: 'Geist Variable'/);
  });

  it('defines light tokens on :root and dark ones on html.dark', () => {
    const css = readFileSync('resources/macroma.css', 'utf8');
    expect(css).toMatch(/:root\s*\{[^}]*--bg: #ECEAE4;/);
    expect(css).toMatch(/html\.dark\s*\{[^}]*--bg: #141416;/);
    expect(css).toMatch(/--c-ongoing: #2D55FF;/);
  });

  it('keeps Macroma surfaces solid: no gradients in its styles', () => {
    const roots = [
      'resources/macroma.css',
      ...filesUnder('src/app'),
      ...filesUnder('src/shared/ui'),
      ...filesUnder('src/features/projects/web'),
      ...filesUnder('src/features/workspaces/web'),
      ...filesUnder('src/features/notifications/web'),
    ].filter((path) => /\.(vue|css)$/.test(path));

    const withGradients = roots.filter((path) => /gradient\(/.test(readFileSync(path, 'utf8')));
    expect(withGradients).toEqual([]);
  });
});
