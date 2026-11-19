<script setup lang="ts">
import { computed } from 'vue';
import { inlineParts } from './openapi-docs';

/** Text from the OpenAPI document with its `code` spans in mono; never parsed as HTML. */
const props = defineProps<{ text: string }>();
const parts = computed(() => inlineParts(props.text));
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"><code v-if="part.code" class="api-text__code">{{ part.text }}</code><template v-else>{{ part.text }}</template></template>
</template>

<style scoped>
.api-text__code {
  padding: 1px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--ink);
  overflow-wrap: anywhere;
}
</style>
