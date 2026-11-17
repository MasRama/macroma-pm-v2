<script setup lang="ts">
/** Label + control + error/hint wrapper shared by the text, select and textarea fields. */
defineProps<{ id: string; label?: string; error?: string; hint?: string }>();
</script>

<template>
  <div class="ui-field">
    <div v-if="label || $slots.aside" class="ui-field__head">
      <label v-if="label" :for="id" class="ui-field__label">{{ label }}</label>
      <span v-if="$slots.aside" class="ui-field__aside"><slot name="aside" /></span>
    </div>
    <slot />
    <p v-if="error" :id="`${id}-error`" class="ui-field__error">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-hint`" class="ui-field__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ui-field__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ui-field__aside {
  margin-left: auto;
}
.ui-field__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mute);
}
.ui-field__error {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-revisi);
}
.ui-field__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mute);
}
</style>
