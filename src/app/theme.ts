import { readonly, ref } from 'vue';

/** Terang, Gelap, or Ikut sistem: the per-browser theme choice on the profile page. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Kept from the Nara starter so a browser's saved choice carries over. */
export const THEME_STORAGE_KEY = 'nara-theme';

const mode = ref<ThemeMode>('system');
let systemQuery: MediaQueryList | undefined;

function readSaved(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches === true;
}

function apply(): void {
  const dark = mode.value === 'dark' || (mode.value === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

function onSystemChange(): void {
  if (mode.value === 'system') apply();
}

/** Reads the saved choice, applies it, and follows the OS while the choice is "Ikut sistem". */
export function initializeTheme(): void {
  mode.value = readSaved();
  apply();
  if (!systemQuery && typeof window.matchMedia === 'function') {
    systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemQuery?.addEventListener?.('change', onSystemChange);
  }
}

export function setTheme(next: ThemeMode): void {
  mode.value = next;
  try {
    if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The choice still applies to this tab.
  }
  apply();
}

export function useTheme() {
  return { mode: readonly(mode), setTheme };
}
