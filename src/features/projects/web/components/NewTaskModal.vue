<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  SegmentedControl,
  SelectField,
  TextArea,
  TextField,
  UiAvatar,
  UiButton,
  UiDropzone,
  UiModal,
  type PersonRef,
} from '../../../../shared/ui';
import type { BatchVersion, NewTaskInput, TaskPriority } from '../view';

const props = withDefaults(
  defineProps<{
    open: boolean;
    batch: BatchVersion;
    members: PersonRef[];
    busy?: boolean;
    /** Field errors from the server, keyed by field. */
    errors?: Partial<Record<'title' | 'description' | 'assigneeId' | 'files', string>>;
  }>(),
  { busy: false, errors: () => ({}) },
);
const emit = defineEmits<{ close: []; submit: [input: NewTaskInput] }>();

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const title = ref('');
const description = ref('');
const priority = ref<string>('medium');
const assigneeId = ref('');
const files = ref<File[]>([]);
const titleError = ref('');

const assignee = computed(() => props.members.find((member) => String(member.id) === assigneeId.value));
const options = computed(() => props.members.map((member) => ({ value: String(member.id), label: member.name })));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = '';
    description.value = '';
    priority.value = 'medium';
    assigneeId.value = '';
    files.value = [];
    titleError.value = '';
  },
);

function submit(): void {
  titleError.value = title.value.trim() ? '' : 'Judul wajib diisi';
  if (titleError.value) return;
  emit('submit', {
    title: title.value.trim(),
    description: description.value.trim(),
    priority: priority.value as TaskPriority,
    assigneeId: assigneeId.value,
    files: files.value,
  });
}
</script>

<template>
  <UiModal :open="open" title="Task baru" :width="460" @close="emit('close')">
    <template #subtitle>
      Masuk ke Backlog, batch <span class="mono">v{{ batch.major }}.{{ batch.minor }}</span>, mulai di
      <span class="mono">v{{ batch.major }}.{{ batch.minor }}.0</span>.
    </template>
    <form id="new-task-form" class="form" novalidate @submit.prevent="submit">
      <TextField id="new-task-title" v-model="title" label="Judul" :error="titleError || errors.title" required />
      <TextArea
        id="new-task-description"
        v-model="description"
        label="Deskripsi"
        placeholder="Tulis konteks, link, atau acceptance criteria…"
        :error="errors.description"
      />
      <div class="form__pair">
        <div>
          <span class="form__label">Prioritas</span>
          <SegmentedControl v-model="priority" :options="PRIORITIES" label="Prioritas" variant="field" />
        </div>
        <SelectField
          id="new-task-assignee"
          v-model="assigneeId"
          label="Assignee"
          placeholder="Pilih orang"
          :options="options"
          :error="errors.assigneeId"
        >
          <template v-if="assignee" #lead><UiAvatar :person="assignee" :size="22" /></template>
        </SelectField>
      </div>
      <UiDropzone id="new-task-images" label="Gambar" @files="files = [...files, ...$event]" />
      <ul v-if="files.length" class="form__files">
        <li v-for="(file, index) in files" :key="`${file.name}-${index}`">
          {{ file.name }}
          <button type="button" class="link" @click="files = files.filter((_, at) => at !== index)">Hapus</button>
        </li>
      </ul>
      <p v-if="errors.files" class="form__error">{{ errors.files }}</p>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="new-task-form" :disabled="busy">Buat task</UiButton>
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
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form__label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.form__files {
  margin: -4px 0 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
  color: var(--ink2);
}
.form__files li {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.form__files .link {
  font-size: 12px;
}
.form__error {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-revisi);
}
</style>
