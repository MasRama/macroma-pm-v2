<script setup lang="ts">
import { computed } from 'vue';
import { SegmentedControl, SelectField, TextArea, TextField, UiAvatar, UiButton, UiModal, type PersonRef } from '../../../../shared/ui';
import type { EditTaskField, EditTaskForm, TaskPriority } from '../view';

/**
 * Edit task: the parent owns each field (one v-model per field), so it can
 * merge a save made elsewhere into the form (STALE_REVISION) and list the
 * fields both sides changed.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    members: PersonRef[];
    busy?: boolean;
    errors?: Partial<Record<EditTaskField, string>>;
    error?: string;
    /** Says the task was saved elsewhere while this form was open. */
    mergeNotice?: string;
    /** Fields both sides changed, waiting for a pick. */
    conflicts?: EditTaskField[];
    /** The task as it was saved elsewhere. */
    theirs?: EditTaskForm | null;
  }>(),
  { busy: false, errors: () => ({}), error: undefined, mergeNotice: '', conflicts: () => [], theirs: null },
);
const emit = defineEmits<{ close: []; submit: []; useTheirs: [field: EditTaskField]; keepMine: [field: EditTaskField] }>();
const title = defineModel<string>('title', { required: true });
const description = defineModel<string>('description', { required: true });
const priority = defineModel<TaskPriority>('priority', { required: true });
const assigneeId = defineModel<string>('assigneeId', { required: true });

const FIELD_LABELS: Record<EditTaskField, string> = { title: 'Judul', description: 'Deskripsi', priority: 'Prioritas', assigneeId: 'Assignee' };
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const options = computed(() => [
  { value: '', label: 'Belum ada' },
  ...props.members.map((member) => ({ value: String(member.id), label: member.name })),
]);
const assignee = computed(() => props.members.find((member) => String(member.id) === assigneeId.value));
const priorityValue = computed({
  get: () => priority.value as string,
  set: (value: string) => {
    priority.value = value as TaskPriority;
  },
});

function theirsLabel(field: EditTaskField): string {
  const value = props.theirs?.[field] ?? '';
  if (field === 'assigneeId') return props.members.find((member) => String(member.id) === value)?.name ?? 'belum ada';
  if (field === 'priority') return PRIORITIES.find((option) => option.value === value)?.label ?? value;
  return value || '(kosong)';
}
</script>

<template>
  <UiModal :open="open" title="Edit task" :width="460" @close="emit('close')">
    <form id="edit-task-form" class="form" novalidate data-testid="edit-task-form" @submit.prevent="emit('submit')">
      <p v-if="mergeNotice" class="form__notice" role="status" data-testid="task-merge-notice">{{ mergeNotice }}</p>
      <TextField id="edit-task-title" v-model="title" label="Judul" :error="errors.title" required />
      <TextArea
        id="edit-task-description"
        v-model="description"
        label="Deskripsi"
        placeholder="Tulis konteks, link, atau acceptance criteria…"
        :error="errors.description"
      />
      <div class="form__pair">
        <div>
          <span class="form__label">Prioritas</span>
          <SegmentedControl v-model="priorityValue" :options="PRIORITIES" label="Prioritas" variant="field" />
        </div>
        <SelectField id="edit-task-assignee" v-model="assigneeId" label="Assignee" :options="options" :error="errors.assigneeId">
          <template v-if="assignee" #lead><UiAvatar :person="assignee" :size="22" /></template>
        </SelectField>
      </div>
      <div v-if="conflicts.length" class="conflicts" data-testid="task-conflicts">
        <div v-for="field in conflicts" :key="field" class="conflict" :data-conflict-field="field">
          <p>
            <b>{{ FIELD_LABELS[field] }}</b> juga diubah orang lain menjadi <q>{{ theirsLabel(field) }}</q>. Pilih yang disimpan.
          </p>
          <div class="conflict__acts">
            <UiButton size="sm" :data-testid="`task-use-theirs-${field}`" @click="emit('useTheirs', field)">Pakai versi mereka</UiButton>
            <UiButton size="sm" variant="ghost" :data-testid="`task-keep-mine-${field}`" @click="emit('keepMine', field)">Pakai punyaku</UiButton>
          </div>
        </div>
      </div>
      <p v-if="error" role="alert" class="form__error">{{ error }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="edit-task-form" :disabled="busy || conflicts.length > 0">Simpan</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form__pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.form__label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}
.form__notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r-small);
  background: var(--fill);
  font-size: 13px;
}
.form__error {
  margin: 0;
  font-size: 13px;
  color: var(--alert);
}
.conflict {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-small);
  font-size: 13px;
}
.conflict p {
  margin: 0 0 8px;
}
.conflict__acts {
  display: flex;
  gap: 6px;
}
@media (max-width: 520px) {
  .form__pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
