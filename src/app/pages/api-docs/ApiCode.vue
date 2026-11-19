<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

/** A code block with a copy button; long lines scroll inside the block, never the page. */
const props = defineProps<{ code: string; label: string; inline?: boolean }>();

const copyState = ref<'idle' | 'done' | 'failed'>('idle');
let reset: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('No clipboard');
    await navigator.clipboard.writeText(props.code);
    copyState.value = 'done';
  } catch {
    copyState.value = 'failed';
  }
  clearTimeout(reset);
  reset = setTimeout(() => (copyState.value = 'idle'), 2000);
}

onUnmounted(() => clearTimeout(reset));
</script>

<template>
  <div class="code" :class="{ 'code--inline': inline }">
    <div class="code__head">
      <span class="code__label">{{ label }}</span>
      <button type="button" class="code__copy focus-ring" :aria-label="`Salin ${label}`" data-testid="copy-code" @click="copy">
        {{ copyState === 'done' ? 'Tersalin' : copyState === 'failed' ? 'Gagal menyalin' : 'Salin' }}
      </button>
      <span class="sr-only" role="status">{{ copyState === 'done' ? `${label} tersalin` : copyState === 'failed' ? `${label} gagal disalin` : '' }}</span>
    </div>
    <pre class="code__body"><code>{{ code }}</code></pre>
  </div>
</template>

<style scoped>
/* Solid ink in both themes (Sena): the same #0E0E10 block on light and dark pages. */
.code {
  --code-bg: #0e0e10;
  --code-fg: #f2f1ec;
  --code-meta: #8d8b86;
  --code-raise: #1e1e21;
  --code-line: #3a3a3e;
  min-width: 0;
  border-radius: var(--r-card);
  background: var(--code-bg);
  border: 1px solid var(--code-bg);
  color: var(--code-fg);
  overflow: hidden;
}
.code__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 8px 7px 14px;
  border-bottom: 1px solid var(--code-line);
}
.code__label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--code-meta);
}
.code__copy {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--code-line);
  border-radius: 6px;
  background: var(--code-raise);
  color: var(--code-fg);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.code__copy:hover {
  border-color: var(--code-meta);
}
.code__body {
  margin: 0;
  padding: 12px 14px 14px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
}
.code--inline {
  display: flex;
  align-items: center;
}
.code--inline .code__head {
  order: 2;
  flex-shrink: 0;
  border-bottom: 0;
  padding-left: 0;
}
.code--inline .code__label {
  display: none;
}
.code--inline .code__body {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
}
</style>
