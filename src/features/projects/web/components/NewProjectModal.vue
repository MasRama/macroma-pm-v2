<script setup lang="ts">
import { ref, watch } from 'vue';
import { TextArea, TextField, UiButton, UiModal } from '../../../../shared/ui';
import type { NewProjectInput } from '../view';

const props = withDefaults(defineProps<{ open: boolean; workspaceName?: string; busy?: boolean; nameError?: string }>(), {
  workspaceName: undefined,
  busy: false,
  nameError: undefined,
});
const emit = defineEmits<{ close: []; submit: [input: NewProjectInput] }>();

const name = ref('');
const description = ref('');
const missingName = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = '';
    description.value = '';
    missingName.value = false;
  },
);

function submit(): void {
  missingName.value = name.value.trim() === '';
  if (!missingName.value) emit('submit', { name: name.value.trim(), description: description.value.trim() });
}
</script>

<template>
  <UiModal
    :open="open"
    title="Project baru"
    :subtitle="workspaceName ? `Masuk ke workspace ${workspaceName}.` : undefined"
    :width="440"
    @close="emit('close')"
  >
    <form id="new-project-form" class="form" novalidate @submit.prevent="submit">
      <TextField id="project-name" v-model="name" label="Nama" placeholder="Nama project" :error="missingName ? 'Nama wajib diisi' : nameError" />
      <TextArea id="project-description" v-model="description" label="Deskripsi" placeholder="Satu kalimat soal project ini" />
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="new-project-form" :disabled="busy">Buat project</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
