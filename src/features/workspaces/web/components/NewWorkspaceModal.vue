<script setup lang="ts">
import { ref, watch } from 'vue';
import { TextArea, TextField, UiButton, UiModal } from '../../../../shared/ui';
import type { NewWorkspaceInput } from '../view';

const props = withDefaults(defineProps<{ open: boolean; busy?: boolean; nameError?: string }>(), {
  busy: false,
  nameError: undefined,
});
const emit = defineEmits<{ close: []; submit: [input: NewWorkspaceInput] }>();

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
  <UiModal :open="open" title="Workspace baru" subtitle="Satu workspace untuk satu tim. Kamu jadi owner-nya." :width="440" @close="emit('close')">
    <form id="new-workspace-form" class="form" novalidate @submit.prevent="submit">
      <TextField id="workspace-name" v-model="name" label="Nama" placeholder="Nama tim atau studio" :error="missingName ? 'Nama wajib diisi' : nameError" />
      <TextArea id="workspace-description" v-model="description" label="Deskripsi" placeholder="Opsional" />
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="new-workspace-form" :disabled="busy">Buat workspace</UiButton>
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
