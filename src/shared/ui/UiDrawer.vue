<script setup lang="ts">
import { toRef } from 'vue';
import { useEscape } from './useDismiss';

const props = withDefaults(defineProps<{ open: boolean; width?: number; label: string }>(), { width: 380 });
const emit = defineEmits<{ close: [] }>();

useEscape(toRef(props, 'open'), () => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-layer">
      <div class="drawer-layer__dim" @click="emit('close')" />
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="label" :style="{ '--drawer-w': `${width}px` }">
        <slot />
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 55;
}
.drawer-layer__dim {
  position: absolute;
  inset: 0;
  background: var(--dim);
}
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--drawer-w);
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-left: 1.5px solid var(--ink);
  box-shadow: var(--shadow-drawer);
}
/* Phones: the drawer takes the whole screen, with no strip of the page and no side border beside it. */
@media (max-width: 600px) {
  .drawer {
    width: 100%;
    border-left: 0;
    box-shadow: none;
  }
}
</style>
