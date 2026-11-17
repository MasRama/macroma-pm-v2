<script setup lang="ts">
import UiField from './UiField.vue';

withDefaults(
  defineProps<{
    id: string;
    label?: string;
    placeholder?: string;
    error?: string;
    hint?: string;
    rows?: number;
    required?: boolean;
    disabled?: boolean;
  }>(),
  { label: undefined, placeholder: undefined, error: undefined, hint: undefined, rows: 3, required: false, disabled: false },
);
const model = defineModel<string>({ default: '' });
</script>

<template>
  <UiField :id="id" :label="label" :error="error" :hint="hint">
    <textarea
      :id="id"
      v-model="model"
      class="ui-control ui-control--area"
      :name="id"
      :rows="rows"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${id}-error` : hint ? `${id}-hint` : undefined"
    />
  </UiField>
</template>

<style scoped src="./control.css"></style>
<style scoped>
.ui-control--area {
  height: auto;
  min-height: 84px;
  padding: 10px 12px;
  line-height: 1.45;
  resize: vertical;
}
</style>
