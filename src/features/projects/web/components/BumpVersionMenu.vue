<script setup lang="ts">
import { DropdownMenu, UiButton } from '../../../../shared/ui';
import { formatVersion } from '../format';
import type { BatchVersion, BumpKind } from '../view';

/** Owner-only menu: Minor (v2.3 → v2.4) or Major (v2.3 → v3.0); both close the active batch. */
defineProps<{ current: BatchVersion }>();
const emit = defineEmits<{ bump: [kind: BumpKind] }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <DropdownMenu v-model:open="open" :width="290">
    <template #trigger="{ toggle }">
      <UiButton icon="up" :aria-expanded="open" aria-haspopup="menu" @click="toggle">Bump versi</UiButton>
    </template>
    <template #default="{ close }">
      <button
        type="button"
        role="menuitem"
        class="bump"
        @click="
          emit('bump', 'minor');
          close();
        "
      >
        <span class="bump__row"><b>Minor</b><span class="mono">{{ formatVersion(current) }} → v{{ current.major }}.{{ current.minor + 1 }}</span></span>
        <span class="bump__desc">Fitur baru. Batch {{ formatVersion(current) }} ditutup.</span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="bump"
        @click="
          emit('bump', 'major');
          close();
        "
      >
        <span class="bump__row"><b>Major</b><span class="mono">{{ formatVersion(current) }} → v{{ current.major + 1 }}.0</span></span>
        <span class="bump__desc">Breaking change. Batch {{ formatVersion(current) }} ditutup.</span>
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
