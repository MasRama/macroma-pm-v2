// @vitest-environment jsdom
import { createApp, defineComponent, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ApiDocsPage from '../pages/ApiDocsPage.vue';
import { baseUrlOf, curlFor, exampleOf, readApiDocs, type DocOperation } from '../pages/api-docs/openapi-docs';
import { sectionAt } from '../pages/api-docs/scroll-spy';
import fixture from './fixtures/openapi-v1.json';

/**
 * The Dokumentasi API page and the renderer behind it, from a fixture
 * OpenAPI document: a part of the server's own document with read and write
 * endpoints (api-docs-fixture.test.ts keeps it equal to the server's).
 */
const docs = readApiDocs(fixture);
const operation = (method: string, path: string): DocOperation => {
  const found = docs.groups.flatMap((group) => group.operations).find((item) => item.method === method && item.path === path);
  if (!found) throw new Error(`No ${method} ${path}`);
  return found;
};

describe('OpenAPI renderer', () => {
  it('groups operations by tag in the declared order', () => {
    expect(docs.title).toBe('Macroma public API');
    expect(docs.groups.map((group) => [group.tag, group.operations.map((item) => `${item.method} ${item.path}`)])).toEqual([
      ['Workspaces', ['GET /workspaces', 'GET /workspaces/{id}']],
      ['Projects', ['GET /projects/{id}/tasks', 'POST /projects/{id}/tasks']],
      [
        'Tasks',
        ['GET /tasks/{id}', 'PATCH /tasks/{id}', 'DELETE /tasks/{id}', 'GET /tasks/{id}/comments', 'POST /tasks/{id}/comments', 'PATCH /tasks/{id}/move'],
      ],
    ]);
    expect(new Set(docs.groups.flatMap((group) => group.operations.map((item) => item.id))).size).toBe(10);
  });

  it('reads path and query parameters with their limits, defaults and allowed values', () => {
    const params = operation('GET', '/projects/{id}/tasks').params;
    expect(params.map((param) => `${param.in}:${param.name}${param.required ? '*' : ''}`)).toEqual([
      'path:id*',
      'query:batch_id',
      'query:column_id',
      'query:assignee_id',
      'query:updated_since',
      'query:cursor',
      'query:limit',
    ]);
    expect(params.find((param) => param.name === 'column_id')?.values).toEqual(['backlog', 'ongoing', 'revisi', 'review', 'done']);
    expect(params.find((param) => param.name === 'limit')).toMatchObject({ type: 'integer', limits: '1–100', fallback: '50' });
    expect(params.find((param) => param.name === 'updated_since')).toMatchObject({ type: 'integer' });
  });

  it('takes the scope from the refusals: TOKEN_SCOPE_INSUFFICIENT means write', () => {
    const scopes = docs.groups.flatMap((group) => group.operations.map((item) => `${item.method} ${item.scope}`));
    expect(scopes).toEqual([
      'GET read',
      'GET read',
      'GET read',
      'POST write',
      'GET read',
      'PATCH write',
      'DELETE write',
      'GET read',
      'POST write',
      'PATCH write',
    ]);
  });

  it('lists body fields with required marks and response fields under data, nested', () => {
    const create = operation('POST', '/projects/{id}/tasks');
    expect(create.status).toBe(201);
    expect(create.body?.map((field) => `${field.name}:${field.type}${field.required ? '*' : ''}`)).toEqual([
      'title:string*',
      'description:string | null',
      'priority:string',
      'assignee_id:string | null',
      'batch_id:string | null',
    ]);
    expect(create.body?.find((field) => field.name === 'priority')).toMatchObject({ values: ['low', 'medium', 'high'] });
    expect(create.bodyExample).toEqual({ title: '<title>' });
    // The document's own example: a new task sits in backlog, so the move names another column.
    expect(operation('PATCH', '/tasks/{id}/move').bodyExample).toEqual({ column_id: 'review' });
    // An edit sends a revision the schema accepts (exclusiveMinimum 0) and one field to change.
    expect(operation('PATCH', '/tasks/{id}').bodyExample).toEqual({ revision: 1, title: '<title>' });

    const list = operation('GET', '/projects/{id}/tasks');
    expect(list.body).toBeNull();
    const paths = list.response.map((field) => field.path);
    expect(paths.slice(0, 2)).toEqual(['tasks', 'tasks[].id']);
    expect(paths).toEqual(expect.arrayContaining(['tasks[].assignee.id', 'tasks[].version.patch', 'next_cursor']));
    expect(list.response.find((field) => field.path === 'tasks')).toMatchObject({ type: 'object[]', depth: 0 });
    expect(list.response.find((field) => field.path === 'tasks[].assignee')).toMatchObject({ type: 'object | null', depth: 1 });
    expect(list.response.find((field) => field.path === 'tasks[].assignee.name')?.depth).toBe(2);
    // An answer with no data (only success and message) has no fields.
    expect(operation('DELETE', '/tasks/{id}').response).toEqual([]);
  });

  it('lists refusals by status with their codes', () => {
    expect(operation('GET', '/tasks/{id}').refusals).toEqual([
      { status: 401, codes: ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED'] },
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED', 'FORBIDDEN'] },
      { status: 404, codes: ['TASK_NOT_FOUND'] },
      { status: 429, codes: ['RATE_LIMITED'] },
    ]);
    // A status with a single refusal names its code as a const.
    expect(operation('PATCH', '/tasks/{id}').refusals.find((refusal) => refusal.status === 409)?.codes).toEqual(['STALE_REVISION']);
    expect(operation('PATCH', '/tasks/{id}/move').refusals.find((refusal) => refusal.status === 409)?.codes).toEqual(['TASK_ALREADY_IN_COLUMN']);
  });

  it('describes pagination and the error envelope when the document has them', () => {
    expect(docs.pagination).toEqual({ limitMin: 1, limitMax: 100, limitDefault: 50 });
    // The code a call without a valid token really gets: the first 401 refusal, not the envelope's first enum value.
    expect(docs.errorExample).toEqual({ success: false, message: '<message>', code: 'TOKEN_INVALID' });
    expect(docs.rateLimit).toEqual({ requests: 120, windowSeconds: 60, code: 'RATE_LIMITED' });
    expect(docs.bearer).toBeDefined();

    const bare = readApiDocs({ openapi: '3.1.0', info: { title: 'Bare' }, paths: { '/ping': { get: { summary: 'Ping', responses: {} } } } });
    expect(bare.pagination).toBeNull();
    expect(bare.errorExample).toBeNull();
    expect(bare.rateLimit).toBeNull();
    expect(bare.bearer).toBeUndefined();
    expect(bare.groups.map((group) => group.tag)).toEqual(['Lainnya']);
  });

  it('picks example values the schema accepts', () => {
    const spec = {};
    expect(exampleOf(spec, { type: 'integer', exclusiveMinimum: 0 })).toBe(1);
    expect(exampleOf(spec, { type: 'integer', minimum: 5, exclusiveMinimum: 2 })).toBe(5);
    expect(exampleOf(spec, { type: 'integer', minimum: 0 })).toBe(0);
    expect(exampleOf(spec, { type: 'number' })).toBe(0);
    expect(exampleOf(spec, { type: 'string', enum: ['a', 'b'], examples: ['b'] })).toBe('b');
    expect(exampleOf(spec, { type: 'string', enum: ['a', 'b'] })).toBe('a');
  });

  it('marks the section in view, and the last one at the bottom of the page', () => {
    const sections = [
      { id: 'a', top: -400 },
      { id: 'b', top: 40 },
      { id: 'c', top: 500 },
    ];
    expect(sectionAt(sections, 96, false)).toBe('b');
    expect(sectionAt(sections, 96, true)).toBe('c');
    expect(sectionAt([{ id: 'a', top: 300 }], 96, false)).toBe('a');
    expect(sectionAt([], 96, false)).toBeUndefined();
  });

  it('makes the base URL absolute against the site, or falls back to /api/v1', () => {
    expect(baseUrlOf({ server: '/api/v1' }, 'https://pm.example.id')).toBe('https://pm.example.id/api/v1');
    expect(baseUrlOf({ server: 'https://api.example.id/v1/' }, 'https://pm.example.id')).toBe('https://api.example.id/v1');
    expect(baseUrlOf({}, 'https://pm.example.id')).toBe('https://pm.example.id/api/v1');
  });

  it('writes curl examples with the token, path variables and a JSON body', () => {
    const base = 'https://pm.example.id/api/v1';
    expect(curlFor(operation('GET', '/projects/{id}/tasks'), base)).toBe(
      ['curl -s "https://pm.example.id/api/v1/projects/$PROJECT_ID/tasks" \\', '  -H "Authorization: Bearer $MACROMA_TOKEN"'].join('\n'),
    );
    expect(curlFor(operation('POST', '/projects/{id}/tasks'), base)).toBe(
      [
        'curl -s -X POST "https://pm.example.id/api/v1/projects/$PROJECT_ID/tasks" \\',
        '  -H "Authorization: Bearer $MACROMA_TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"title":"<title>"}'`,
      ].join('\n'),
    );
    expect(curlFor(operation('PATCH', '/tasks/{id}'), base)).toBe(
      [
        'curl -s -X PATCH "https://pm.example.id/api/v1/tasks/$TASK_ID" \\',
        '  -H "Authorization: Bearer $MACROMA_TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"revision":1,"title":"<title>"}'`,
      ].join('\n'),
    );
    expect(curlFor(operation('PATCH', '/tasks/{id}/move'), base)).toContain(`-d '{"column_id":"review"}'`);
    expect(curlFor(operation('DELETE', '/tasks/{id}'), base)).toBe(
      ['curl -s -X DELETE "https://pm.example.id/api/v1/tasks/$TASK_ID" \\', '  -H "Authorization: Bearer $MACROMA_TOKEN"'].join('\n'),
    );
  });

  it('refuses anything that is not an OpenAPI document', () => {
    expect(() => readApiDocs({ hello: 'world' })).toThrow();
    expect(() => readApiDocs(null)).toThrow();
  });
});

describe('Dokumentasi API page', () => {
  let app: App | undefined;

  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
      await nextTick();
    }
  }

  /** Mounts the page inside a scrolling shell, as the app's `.shell__main`. */
  async function mount(): Promise<HTMLElement> {
    const topbar = document.createElement('div');
    topbar.id = 'shell-topbar';
    const shell = document.createElement('div');
    shell.style.overflowY = 'auto';
    const host = document.createElement('div');
    shell.append(host);
    document.body.append(topbar, shell);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/tokens', name: 'api-tokens', component: defineComponent({ render: () => null }) },
        { path: '/:any(.*)*', component: defineComponent({ render: () => null }) },
      ],
    });
    await router.push('/settings/api-docs');
    app = createApp(ApiDocsPage).use(router);
    app.mount(host);
    return shell;
  }

  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const allByTestId = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
  const text = () => document.body.textContent ?? '';

  it('fetches the public document and shows a loading state until it arrives', async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchSpy);
    await mount();
    await settle();

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/openapi.json', expect.anything());
    expect(byTestId('api-docs-loading')?.textContent).toContain('Memuat dokumentasi API');
    expect(byTestId('api-docs-nav')).toBeNull();

    release(new Response(JSON.stringify(fixture)));
    await settle();
    expect(byTestId('api-docs-loading')).toBeNull();
    expect(allByTestId('api-docs-operation')).toHaveLength(10);
  });

  it('draws the intro, groups and each endpoint from the document', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer(fixture)));
    await mount();
    await settle();

    const base = `${window.location.origin}/api/v1`;
    expect(byTestId('api-docs-base')?.querySelector('pre')?.textContent).toBe(base);
    expect(byTestId('api-docs-intro')?.textContent).toContain('Authorization: Bearer mcr_...');
    expect(byTestId('api-docs-tokens')?.getAttribute('href')).toBe('/settings/tokens');
    expect(byTestId('api-docs-pagination')?.textContent).toContain('1–100, bawaan 50');
    expect(byTestId('api-docs-errors')?.textContent).toContain('"code": "TOKEN_INVALID"');
    const rate = byTestId('api-docs-rate')?.textContent?.replace(/\s+/g, ' ');
    expect(rate).toContain('Setiap token boleh mengirim 120 permintaan per menit.');
    expect(rate).toContain('429 RATE_LIMITED');
    expect(rate).toContain('Retry-After');

    expect(allByTestId('api-docs-group').map((group) => group.querySelector('h2')?.textContent)).toEqual(['Workspaces', 'Projects', 'Tasks']);

    const create = allByTestId('api-docs-operation').find((card) => card.textContent?.includes('Create a task'))!;
    expect(create.querySelector('.method')?.textContent).toBe('POST');
    expect(create.querySelector('[data-testid="api-docs-path"]')?.textContent).toBe('/api/v1/projects/{id}/tasks');
    expect(create.querySelector('[data-testid="api-docs-scope"]')?.textContent).toBe('write');
    const bodyFields = [...create.querySelectorAll('[data-testid="api-docs-body"] [data-testid="api-field"]')];
    expect(bodyFields.map((field) => field.getAttribute('data-path'))).toEqual(['title', 'description', 'priority', 'assignee_id', 'batch_id']);
    expect(bodyFields[0]?.textContent).toContain('wajib');
    expect(create.querySelector('[data-testid="api-docs-curl"] pre')?.textContent).toBe(curlFor(operation('POST', '/projects/{id}/tasks'), base));

    const tasks = allByTestId('api-docs-operation').find((card) => card.textContent?.includes("List a project's tasks"))!;
    expect(tasks.querySelector('[data-testid="api-docs-scope"]')?.textContent).toBe('read');
    const rows = [...tasks.querySelectorAll('[data-testid="api-docs-params"] tbody tr')];
    expect(rows.map((row) => row.querySelector('code')?.textContent)).toEqual(['id', 'batch_id', 'column_id', 'assignee_id', 'updated_since', 'cursor', 'limit']);
    expect(rows[0]?.textContent).toContain('wajib');
    expect(rows[2]?.textContent).toContain('revisi');
    // Response fields sit in a closed disclosure until opened.
    const response = tasks.querySelector<HTMLDetailsElement>('[data-testid="api-docs-response"]')!;
    expect(response.open).toBe(false);
    expect(response.querySelector('summary')?.textContent).toContain('200');
    expect([...response.querySelectorAll('[data-testid="api-field"]')].map((field) => field.getAttribute('data-path'))).toContain('tasks[].assignee.id');
    expect(response.textContent).toContain('BATCH_NOT_FOUND');
    // Response fields are always present, not sent: no "wajib" mark there.
    expect([...response.querySelectorAll('[data-testid="api-field"]')].some((field) => field.textContent?.includes('wajib'))).toBe(false);

    // The phone jump list names every endpoint.
    const jump = byTestId('api-docs-jump') as HTMLSelectElement;
    expect([...jump.options].map((option) => option.value)).toEqual(['api-intro', ...docs.groups.flatMap((group) => group.operations.map((item) => item.id))]);
  });

  it('keeps the jumped-to card selected, also the last one that cannot reach the top', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer(fixture)));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const shell = await mount();
      await settle();

      // Geometry jsdom lacks: where each card's top sits and how far the shell is scrolled.
      const ids = ['api-intro', ...docs.groups.flatMap((group) => group.operations.map((item) => item.id))];
      const [last, beforeLast] = [ids[ids.length - 1], ids[ids.length - 2]];
      let tops: Record<string, number> = {};
      for (const id of ids) document.getElementById(id)!.getBoundingClientRect = () => ({ top: tops[id] ?? 2000 }) as DOMRect;
      shell.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
      const scrolled = (scrollTop: number, sectionTops: Record<string, number>) => {
        tops = sectionTops;
        Object.defineProperties(shell, {
          scrollTop: { value: scrollTop, configurable: true },
          clientHeight: { value: 800, configurable: true },
          scrollHeight: { value: 3000, configurable: true },
        });
        shell.dispatchEvent(new Event('scroll'));
      };
      // The last card stops low in the view: the card before it still covers the top.
      const atBottom = { [beforeLast]: -200, [last]: 320 };
      const midway = { [beforeLast]: 40, [last]: 700 };
      const jump = byTestId('api-docs-jump') as HTMLSelectElement;
      const selected = async () => {
        await settle();
        return { select: jump.value, nav: byTestId('api-docs-nav')?.querySelector('[aria-current="true"]')?.getAttribute('href') };
      };

      jump.value = last;
      jump.dispatchEvent(new Event('change'));
      expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById(last));
      scrolled(1600, midway);
      scrolled(2200, atBottom);
      expect(await selected()).toEqual({ select: last, nav: `#${last}` });

      // Scrolling by hand follows the reader again; the bottom of the page is the last card.
      shell.dispatchEvent(new Event('wheel'));
      scrolled(1600, midway);
      expect(await selected()).toEqual({ select: beforeLast, nav: `#${beforeLast}` });
      scrolled(2200, atBottom);
      expect(await selected()).toEqual({ select: last, nav: `#${last}` });

      // A card near the bottom that is jumped to stays selected too.
      jump.value = beforeLast;
      jump.dispatchEvent(new Event('change'));
      scrolled(2200, atBottom);
      expect(await selected()).toEqual({ select: beforeLast, nav: `#${beforeLast}` });
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('copies a curl example and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer(fixture)));
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mount();
    await settle();

    const card = allByTestId('api-docs-operation').find((item) => item.textContent?.includes('Delete a task'))!;
    const button = card.querySelector<HTMLButtonElement>('[data-testid="api-docs-curl"] [data-testid="copy-code"]')!;
    expect(button.textContent?.trim()).toBe('Salin');
    button.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(curlFor(operation('DELETE', '/tasks/{id}'), `${window.location.origin}/api/v1`));
    expect(button.textContent?.trim()).toBe('Tersalin');
  });

  it('says when copying fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer(fixture)));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    await mount();
    await settle();

    const button = byTestId('api-docs-base')!.querySelector<HTMLButtonElement>('[data-testid="copy-code"]')!;
    button.click();
    await settle();
    expect(button.textContent?.trim()).toBe('Gagal menyalin');
  });

  it('shows an Indonesian error with a retry when the document cannot be fetched', async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
      .mockImplementationOnce(() => answer({ success: false, message: 'Server error.', code: 'INTERNAL_ERROR' }, 500))
      .mockImplementationOnce(() => answer(fixture));
    vi.stubGlobal('fetch', fetchSpy);
    await mount();
    await settle();

    const error = byTestId('api-docs-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Dokumentasi API gagal dimuat.');
    expect(error?.textContent).toContain('coba lagi');
    expect(text()).not.toContain('Failed to fetch');

    // A refusal from the server (500) is a failure too.
    byTestId('api-docs-retry')!.click();
    await settle();
    expect(byTestId('api-docs-error')).not.toBeNull();

    byTestId('api-docs-retry')!.click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(byTestId('api-docs-error')).toBeNull();
    expect(allByTestId('api-docs-operation')).toHaveLength(10);
  });

  it('refuses a document that is not OpenAPI', async () => {
    vi.stubGlobal('fetch', vi.fn(() => answer({ hello: 'world' })));
    await mount();
    await settle();
    expect(byTestId('api-docs-error')).not.toBeNull();
  });
});
