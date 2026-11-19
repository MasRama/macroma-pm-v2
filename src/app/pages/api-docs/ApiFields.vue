<script setup lang="ts">
import ApiText from './ApiText.vue';
import type { DocField } from './openapi-docs';

/**
 * A body or response field list; nested fields are indented under their parent.
 * `wajib` marks a field the caller must send, so a response list leaves it out.
 */
defineProps<{ fields: DocField[]; root?: string; marksRequired?: boolean }>();
</script>

<template>
  <ul class="fields">
    <li v-if="root" class="fields__row fields__row--root">
      <code class="fields__name">{{ root }}</code>
      <span class="fields__type">object</span>
    </li>
    <li
      v-for="field in fields"
      :key="field.path"
      class="fields__row"
      :class="{ 'fields__row--nested': field.depth + (root ? 1 : 0) > 0 }"
      :style="{ '--depth': field.depth + (root ? 1 : 0) }"
      :title="field.path"
      data-testid="api-field"
      :data-path="field.path"
    >
      <div class="fields__line">
        <code class="fields__name">{{ field.name }}</code>
        <span class="fields__type">{{ field.type }}</span>
        <span v-if="marksRequired && field.required" class="fields__need">wajib</span>
        <span v-if="field.fallback !== undefined" class="fields__meta">bawaan {{ field.fallback }}</span>
      </div>
      <p v-if="field.description" class="fields__desc"><ApiText :text="field.description" /></p>
      <div v-if="field.values" class="fields__values">
        <code v-for="value in field.values" :key="value">{{ value }}</code>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.fields {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.fields__row {
  padding: 7px 0 7px calc(var(--depth, 0) * 16px);
  border-bottom: 1px solid var(--line-soft);
  min-width: 0;
}
.fields__row:last-child {
  border-bottom: 0;
}
/* A short rule marks how deep a nested field sits. */
.fields__row--nested {
  position: relative;
}
.fields__row--nested::before {
  content: '';
  position: absolute;
  left: calc(var(--depth, 0) * 16px - 10px);
  top: 15px;
  width: 6px;
  border-top: 1px solid var(--line);
}
.fields__row--root {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.fields__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}
.fields__name {
  font-family: var(--font-mono);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.fields__type {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--mute);
  overflow-wrap: anywhere;
}
.fields__need {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-revisi);
}
.fields__meta {
  font-size: 12px;
  color: var(--mute);
}
.fields__desc {
  margin: 3px 0 0;
  line-height: 1.5;
  color: var(--ink2);
}
.fields__values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.fields__values code {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
</style>
