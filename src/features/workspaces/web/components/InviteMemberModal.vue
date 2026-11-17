<script setup lang="ts">
import { ref, watch } from 'vue';
import { TextField, UiButton, UiModal } from '../../../../shared/ui';

const props = withDefaults(
  defineProps<{ open: boolean; workspaceName: string; busy?: boolean; emailError?: string }>(),
  { busy: false, emailError: undefined },
);
const emit = defineEmits<{ close: []; submit: [email: string] }>();

const email = ref('');
const localError = ref<string | undefined>();
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    email.value = '';
    localError.value = undefined;
  },
);

function submit(): void {
  const value = email.value.trim();
  localError.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : 'Masukkan email yang valid';
  if (!localError.value) emit('submit', value);
}
</script>

<template>
  <UiModal :open="open" title="Undang anggota" :subtitle="`Undangan masuk ke notifikasi dan email mereka, untuk ${workspaceName}.`" :width="440" @close="emit('close')">
    <form id="invite-form" novalidate @submit.prevent="submit">
      <TextField id="invite-email" v-model="email" type="email" label="Email" placeholder="nama@domain.com" :error="localError ?? emailError" autocomplete="email" />
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Batal</UiButton>
      <UiButton variant="primary" type="submit" form="invite-form" :disabled="busy">Kirim undangan</UiButton>
    </template>
  </UiModal>
</template>
