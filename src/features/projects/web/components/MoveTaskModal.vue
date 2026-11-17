<script setup lang="ts">
import { ref, watch } from 'vue';
import { TextArea, UiButton, UiIcon, UiModal } from '../../../../shared/ui';
import VersionText from './VersionText.vue';
import { STATUS_COLOR, STATUS_LABEL } from '../format';
import { TASK_STATUSES, type MoveTaskInput, type TaskCardData, type TaskStatus, type TaskVersion } from '../view';

const props = withDefaults(
  defineProps<{
    open: boolean;
    task: TaskCardData | null;
    /** Preselected target (dragging a card onto a column opens this with that column). */
    initialTarget?: TaskStatus | null;
    /** The version the move will give the task, by the API's versioning rule. */
    nextVersion?: TaskVersion | null;
    busy?: boolean;
    /** Server-side error for the note, shown under the field. */
    noteError?: string;
    /** A refusal that is not about the note. */
    error?: string;
  }>(),
  { initialTarget: null, nextVersion: null, busy: false, noteError: undefined, error: undefined },
);
const emit = defineEmits<{ close: []; submit: [input: MoveTaskInput] }>();

const target = ref<TaskStatus | null>(null);
const note = ref('');
const missingNote = ref(false);

watch(
  () => [props.open, props.initialTarget] as const,
  ([open]) => {
    if (!open) return;
    target.value = props.initialTarget && props.initialTarget !== props.task?.status ? props.initialTarget : null;
    note.value = '';
    missingNote.value = false;
  },
  { immediate: true },
);

function submit(): void {
  if (!props.task || !target.value) return;
  missingNote.value = note.value.trim() === '';
  if (missingNote.value) return;
  emit('submit', { taskId: props.task.id, to: target.value, note: note.value.trim() });
}
</script>

<template>
  <UiModal :open="open && task !== null" title="Pindah task" :subtitle="task?.title" :width="440" @close="emit('close')">
    <form v-if="task" id="move-task-form" class="move" novalidate @submit.prevent="submit">
      <fieldset class="move__targets">
        <legend class="move__label">Pindah ke</legend>
        <div class="move__tiles">
          <button
            v-for="status in TASK_STATUSES"
            :key="status"
            type="button"
            class="move__tile focus-ring"
            :class="{ 'move__tile--current': status === task.status, 'move__tile--on': status === target }"
            :style="status === target ? { background: STATUS_COLOR[status] } : undefined"
            :disabled="status === task.status"
            :aria-pressed="status === target"
            @click="target = status"
          >
            {{ STATUS_LABEL[status] }}
          </button>
        </div>
      </fieldset>
      <div v-if="nextVersion" class="move__preview">
        <VersionText class="move__from" :version="task.version" />
        <UiIcon name="arrow" :size="14" :stroke="2.2" class="move__arrow" />
        <VersionText class="move__to" :version="nextVersion" />
        <span class="move__auto">versi baru otomatis</span>
      </div>
      <TextArea
        id="move-task-note"
        v-model="note"
        label="Catatan versi"
        placeholder="Apa yang berubah di versi ini?"
        :error="missingNote ? 'Catatan wajib diisi' : noteError"
        required
      />
      <p v-if="error" role="alert" class="move__error" data-testid="move-task-error">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="move-task-form" :disabled="busy || !target">
        {{ target ? `Pindah ke ${STATUS_LABEL[target]}` : 'Pilih status' }}
      </UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.move__error {
  margin: 0;
  font-size: 13px;
  color: var(--alert);
}
.move {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.move__targets {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.move__label {
  padding: 0;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.move__tiles {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.move__tile {
  border: 1.5px solid var(--line);
  border-radius: 8px;
  padding: 9px 0;
  background: none;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
  cursor: pointer;
  white-space: nowrap;
}
.move__tile--current {
  background: var(--fill);
  cursor: default;
}
.move__tile--on {
  border-color: transparent;
  color: #fff;
  font-weight: 700;
}
.move__preview {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--r-card);
  background: var(--block);
  border: 1px solid var(--block-line);
  color: var(--block-fg);
}
.move__from {
  font-size: 16px;
  font-weight: 600;
  color: var(--block-meta);
}
.move__arrow {
  color: var(--block-meta);
}
.move__to {
  font-size: 20px;
  font-weight: 700;
}
.move__auto {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--block-meta);
}
</style>
