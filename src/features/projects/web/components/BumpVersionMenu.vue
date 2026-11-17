<script setup lang="ts">
import { DropdownMenu, UiButton } from '../../../../shared/ui';
import { formatVersion } from '../format';
import { nextBatchVersion, type BatchVersion, type BumpKind } from '../view';

/**
 * Owner-only menu: Minor (v2.3 → v2.4) or Major (v2.3 → v3.0) after the
 * project's highest version, or v0.1 / v1.0 for its first batch. The new
 * batch becomes the active one, closing the batch that was active.
 */
const props = withDefaults(
  defineProps<{
    /** The project's highest batch version; `null` before its first batch. */
    current: BatchVersion | null;
    /** The active batch the bump closes, if any. */
    closing?: BatchVersion | null;
  }>(),
  { closing: null },
);
const emit = defineEmits<{ bump: [kind: BumpKind] }>();
const open = defineModel<boolean>('open', { default: false });

const options: { kind: BumpKind; label: string; reason: string }[] = [
  { kind: 'minor', label: 'Minor', reason: 'Fitur baru.' },
  { kind: 'major', label: 'Major', reason: 'Breaking change.' },
];
function step(kind: BumpKind): string {
  const next = formatVersion(nextBatchVersion(props.current, kind));
  return props.current ? `${formatVersion(props.current)} → ${next}` : `→ ${next}`;
}
function effect(): string {
  if (props.closing) return `Batch ${formatVersion(props.closing)} ditutup.`;
  return props.current ? 'Jadi batch aktif.' : 'Batch pertama project ini.';
}
</script>

<template>
  <DropdownMenu v-model:open="open" :width="290">
    <template #trigger="{ toggle }">
      <UiButton icon="up" :aria-expanded="open" aria-haspopup="menu" data-testid="bump-version" @click="toggle">Bump versi</UiButton>
    </template>
    <template #default="{ close }">
      <button
        v-for="option in options"
        :key="option.kind"
        type="button"
        role="menuitem"
        class="bump"
        :data-testid="`bump-${option.kind}`"
        @click="
          emit('bump', option.kind);
          close();
        "
      >
        <span class="bump__row"><b>{{ option.label }}</b><span class="mono">{{ step(option.kind) }}</span></span>
        <span class="bump__desc">{{ option.reason }} {{ effect() }}</span>
      </button>
    </template>
  </DropdownMenu>
</template>

<style scoped>
.bump {
  display: block;
  width: 100%;
  padding: 11px 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
}
.bump:hover,
.bump:focus-visible {
  background: var(--fill);
  outline: none;
}
.bump__row {
  display: flex;
  align-items: center;
}
.bump__row b {
  font-size: 13.5px;
}
.bump__row .mono {
  margin-left: auto;
  font-size: 12.5px;
  font-weight: 700;
}
.bump__desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--mute);
}
</style>
