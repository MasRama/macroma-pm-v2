// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import DropdownMenu from '../DropdownMenu.vue';
import UiDrawer from '../UiDrawer.vue';

/*
 * Phones (up to 600px wide) get drawers at full width with no side border, and sheet menus over
 * a scrim. jsdom applies no media queries, so these check what the CSS rules hang on: the
 * drawer's width is a custom property (an inline `width` would beat the phone rule), the phone
 * rules exist, and a sheet menu renders its scrim.
 */
const source = (file: string) => readFileSync(resolve(process.cwd(), 'src/shared/ui', file), 'utf8');
const phoneRules = (css: string) => css.slice(css.indexOf('@media (max-width: 600px)'));

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

describe('UiDrawer on phones', () => {
  it('sets its width as --drawer-w, so the phone rule can take it to the full screen', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({ render: () => h(UiDrawer, { open: true, label: 'Chat workspace', width: 380 }, () => 'isi') });
    app.mount(host);
    await nextTick();
    const drawer = document.querySelector<HTMLElement>('.drawer')!;
    expect(drawer.style.getPropertyValue('--drawer-w')).toBe('380px');
    expect(drawer.style.width).toBe('');
  });

  it('is full width with no left border and no shadow at 600px and below', () => {
    const css = source('UiDrawer.vue');
    expect(css).toContain('width: var(--drawer-w)');
    const phone = phoneRules(css);
    expect(phone).toMatch(/\.drawer\s*\{[^}]*width:\s*100%/);
    expect(phone).toMatch(/\.drawer\s*\{[^}]*border-left:\s*0/);
    expect(phone).toMatch(/\.drawer\s*\{[^}]*box-shadow:\s*none/);
  });
});

describe('DropdownMenu as a phone sheet', () => {
  it('renders a scrim behind a sheet menu that closes it, and none for a plain menu', async () => {
    const open = ref(true);
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({
      render: () => [
        h(DropdownMenu, { sheet: true, open: open.value, 'onUpdate:open': (value: boolean) => (open.value = value) }, { trigger: () => h('button', 'Bel'), default: () => 'isi' }),
        h(DropdownMenu, { open: true }, { trigger: () => h('button', 'Menu'), default: () => 'isi' }),
      ],
    });
    app.mount(host);
    await nextTick();
    const scrims = document.querySelectorAll<HTMLElement>('.dd__scrim');
    expect(scrims).toHaveLength(1);
    expect([...document.querySelectorAll('.dd__panel')].map((panel) => panel.classList.contains('dd__panel--sheet'))).toEqual([true, false]);
    scrims[0]!.click();
    await nextTick();
    expect(open.value).toBe(false);
    expect(document.querySelectorAll('.dd__scrim')).toHaveLength(0);
  });

  it('shows the scrim only at 600px and below, with the sheet inside the 16px side gutter', () => {
    const css = source('DropdownMenu.vue');
    expect(css).toMatch(/\.dd__scrim\s*\{[^}]*display:\s*none/);
    const phone = phoneRules(css);
    expect(phone).toMatch(/\.dd__scrim\s*\{[^}]*display:\s*block[^}]*background:\s*var\(--dim\)/);
    expect(phone).toMatch(/\.dd__panel--sheet\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/);
  });
});
