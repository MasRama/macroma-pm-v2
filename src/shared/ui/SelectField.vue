<script setup lang="ts">
import UiField from './UiField.vue';
import UiIcon from './UiIcon.vue';

import type { SelectOption } from './options';

withDefaults(
  defineProps<{
    id: string;
    options: SelectOption[];
    label?: string;
    placeholder?: string;
    error?: string;
    hint?: string;
    disabled?: boolean;
  }>(),
  { label: undefined, placeholder: undefined, error: undefined, hint: undefined, disabled: false },
);
const model = defineModel<string>({ default: '' });
</script>

<template>
  <UiField :id="id" :label="label" :error="error" :hint="hint">
    <div class="ui-select">
      <span v-if="$slots.lead" class="ui-select__lead"><slot name="lead" /></span>
      <select
        :id="id"
        v-model="model"
        class="ui-control ui-select__control"
        :class="{ 'ui-select__control--lead': $slots.lead }"
        :name="id"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <UiIcon name="chevron" :size="14" :stroke="2" class="ui-select__chevron" />
    </div>
  </UiField>
</template>

<style scoped src="./control.css"></style>
<style scoped>
.ui-select {
  position: relative;
  display: flex;
  align-items: center;
}
.ui-select__control {
  appearance: none;
  padding-right: 34px;
  cursor: pointer;
}
.ui-select__control--lead {
  padding-left: 42px;
}
.ui-select__lead {
  position: absolute;
  left: 12px;
  display: flex;
  pointer-events: none;
}
.ui-select__chevron {
  position: absolute;
  right: 12px;
  color: var(--mute);
  pointer-events: none;
}
</style>
