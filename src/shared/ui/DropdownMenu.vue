<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useEscape } from './useDismiss';

withDefaults(
  defineProps<{
    width?: number;
    align?: 'left' | 'right';
    padded?: boolean;
    /** On phones (600px and below) the open panel sits over a scrim that closes it, like a sheet. */
    sheet?: boolean;
  }>(),
  { width: 290, align: 'right', padded: true, sheet: false },
);
const open = defineModel<boolean>('open', { default: false });
const root = ref<HTMLElement>();

function toggle(): void {
  open.value = !open.value;
}
function close(): void {
  open.value = false;
}
function onPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

useEscape(open, close);
watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onPointer);
  else document.removeEventListener('pointerdown', onPointer);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointer));
</script>

<template>
  <div ref="root" class="dd">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div v-if="open && sheet" class="dd__scrim" @click="close" />
    <div
      v-if="open"
      class="dd__panel"
      :class="[`dd__panel--${align}`, { 'dd__panel--padded': padded, 'dd__panel--sheet': sheet }]"
      :style="{ width: `${width}px` }"
      role="menu"
    >
      <slot :close="close" />
    </div>
  </div>
</template>

<style scoped>
.dd {
  position: relative;
  display: inline-flex;
}
.dd__panel {
  position: absolute;
  top: calc(100% + 8px);
  z-index: 50;
  max-width: calc(100vw - 24px);
  background: var(--card);
  border: 1px solid var(--float-line);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-menu);
  overflow: hidden;
}
.dd__panel--padded {
  padding: 6px;
}
.dd__panel--right {
  right: 0;
}
.dd__panel--left {
  left: 0;
}
.dd__scrim {
  display: none;
}
@media (max-width: 600px) {
  .dd__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 49;
    background: var(--dim);
  }
  /* Keep the sheet inside the page's 16px side gutter, the same on both sides. */
  .dd__panel--sheet {
    max-width: calc(100vw - 32px);
  }
}
</style>
