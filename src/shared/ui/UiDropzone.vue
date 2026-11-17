<script setup lang="ts">
import { ref } from 'vue';

withDefaults(
  defineProps<{
    id: string;
    label?: string;
    title?: string;
    hint?: string;
    accept?: string;
    multiple?: boolean;
  }>(),
  {
    label: undefined,
    title: 'Klik atau drag gambar ke sini',
    hint: 'JPEG, PNG, GIF, WebP · maks 5MB per file',
    accept: 'image/jpeg,image/png,image/gif,image/webp',
    multiple: true,
  },
);
const emit = defineEmits<{ files: [files: File[]] }>();
const over = ref(false);

function pick(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit('files', [...(input.files ?? [])]);
  input.value = '';
}
function drop(event: DragEvent): void {
  over.value = false;
  emit('files', [...(event.dataTransfer?.files ?? [])]);
}
</script>

<template>
  <div class="dz-wrap">
    <span v-if="label" class="dz-label">{{ label }}</span>
    <label
      :for="id"
      class="dz"
      :class="{ 'dz--over': over }"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="drop"
    >
      {{ title }}
      <span class="dz__hint">{{ hint }}</span>
      <input :id="id" class="sr-only" type="file" :accept="accept" :multiple="multiple" @change="pick" />
    </label>
  </div>
</template>

<style scoped>
.dz-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
  margin-bottom: 6px;
}
.dz {
  display: block;
  border: 1.5px dashed var(--dash);
  border-radius: var(--r-card);
  padding: 16px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink2);
  cursor: pointer;
}
.dz--over,
.dz:focus-within {
  border-color: var(--ink);
}
.dz__hint {
  display: block;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--mute);
  margin-top: 3px;
}
</style>
