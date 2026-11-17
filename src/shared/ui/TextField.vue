<script setup lang="ts">
import UiField from './UiField.vue';

withDefaults(
  defineProps<{
    id: string;
    label?: string;
    type?: string;
    placeholder?: string;
    error?: string;
    hint?: string;
    autocomplete?: string;
    name?: string;
    required?: boolean;
    disabled?: boolean;
    size?: 'md' | 'lg';
    inputmode?: 'text' | 'numeric' | 'email' | 'tel' | 'search' | 'url';
  }>(),
  {
    label: undefined,
    type: 'text',
    placeholder: undefined,
    error: undefined,
    hint: undefined,
    autocomplete: undefined,
    name: undefined,
    required: false,
    disabled: false,
    size: 'md',
    inputmode: undefined,
  },
);
const model = defineModel<string>({ default: '' });
</script>

<template>
  <UiField :id="id" :label="label" :error="error" :hint="hint">
    <template v-if="$slots.aside" #aside><slot name="aside" /></template>
    <input
      :id="id"
      v-model="model"
      class="ui-control"
      :class="{ 'ui-control--lg': size === 'lg', 'ui-control--secret': type === 'password' && model }"
      :type="type"
      :name="name ?? id"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? `${id}-error` : hint ? `${id}-hint` : undefined"
    />
  </UiField>
</template>

<style scoped src="./control.css"></style>
<style scoped>
.ui-control--secret {
  letter-spacing: 3px;
}
</style>
