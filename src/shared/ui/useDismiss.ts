import { onBeforeUnmount, watch, type Ref } from 'vue';

/** Calls `dismiss` on Escape while `open` is true (modals, drawers, menus). */
export function useEscape(open: Ref<boolean>, dismiss: () => void): void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss();
  };
  const stop = watch(
    open,
    (value) => {
      if (typeof window === 'undefined') return;
      if (value) window.addEventListener('keydown', onKey);
      else window.removeEventListener('keydown', onKey);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    stop();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
  });
}
