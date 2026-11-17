<script setup lang="ts">
import { toRef } from 'vue';
import CloseButton from './CloseButton.vue';
import { useEscape } from './useDismiss';

const props = withDefaults(
  defineProps<{
    open: boolean;
    width?: number;
    title?: string;
    subtitle?: string;
    /** "panel": small form/confirm dialog. "sheet": large detail view (task detail), laid out by its content. */
    variant?: 'panel' | 'sheet';
  }>(),
  { width: 460, title: undefined, subtitle: undefined, variant: 'panel' },
);
const emit = defineEmits<{ close: [] }>();

useEscape(toRef(props, 'open'), () => emit('close'));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="layer">
      <div class="layer__dim" @click="emit('close')" />
      <div
        class="modal"
        :class="`modal--${variant}`"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :style="{ width: `${width}px` }"
      >
        <header v-if="title" class="modal__head">
          <div class="modal__titles">
            <h2 class="h2">{{ title }}</h2>
            <p v-if="subtitle || $slots.subtitle" class="sub"><slot name="subtitle">{{ subtitle }}</slot></p>
          </div>
          <CloseButton @click="emit('close')" />
        </header>
        <div :class="variant === 'panel' ? 'modal__body' : 'modal__sheet'"><slot /></div>
        <footer v-if="$slots.footer" class="modal__foot"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
}
.layer__dim {
  position: fixed;
  inset: 0;
  background: var(--dim);
}
.modal {
  position: relative;
  max-width: 100%;
  background: var(--card);
  color: var(--ink);
}
.modal--panel {
  border: 1px solid var(--float-line);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-float);
}
.modal--sheet {
  border-radius: 14px;
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: min(800px, calc(100dvh - 48px));
}
.modal__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 22px 0;
}
.modal__titles {
  flex: 1;
  min-width: 0;
}
.modal__body {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal__sheet {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--line);
}
@media (max-width: 640px) {
  .layer {
    padding: 12px;
    align-items: flex-end;
  }
  .modal--sheet {
    height: calc(100dvh - 24px);
  }
}
</style>
