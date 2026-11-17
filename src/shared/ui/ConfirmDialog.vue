<script setup lang="ts">
import { toRef } from 'vue';
import UiButton from './UiButton.vue';
import UiIcon from './UiIcon.vue';
import { useEscape } from './useDismiss';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    busy?: boolean;
  }>(),
  { cancelLabel: 'Batal', busy: false },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();

useEscape(toRef(props, 'open'), () => emit('cancel'));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="layer">
      <div class="layer__dim" @click="emit('cancel')" />
      <div class="confirm" role="alertdialog" aria-modal="true" :aria-label="title">
        <span class="confirm__icon"><UiIcon name="trash" :size="20" :stroke="2.2" /></span>
        <h2 class="h2">{{ title }}</h2>
        <p class="sub confirm__msg">{{ message }}</p>
        <div class="confirm__acts">
          <UiButton variant="ghost" @click="emit('cancel')">{{ cancelLabel }}</UiButton>
          <UiButton variant="danger" :disabled="busy" @click="emit('confirm')">{{ confirmLabel }}</UiButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  /* A 1fr track keeps the dialog inside the viewport; an auto track would grow to 400px. */
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  padding: 24px;
}
.layer__dim {
  position: fixed;
  inset: 0;
  background: var(--dim);
}
.confirm {
  position: relative;
  width: min(400px, 100%);
  padding: 22px;
  background: var(--card);
  border: 1px solid var(--float-line);
  border-radius: var(--r-panel);
  box-shadow: var(--shadow-float);
}
.confirm__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--c-revisi);
  color: #fff;
  display: grid;
  place-items: center;
  margin-bottom: 14px;
}
.confirm__msg {
  line-height: 1.5;
}
.confirm__acts {
  margin-top: 18px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
