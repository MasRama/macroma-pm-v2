<script setup lang="ts">
import UiAvatar from './UiAvatar.vue';
import type { PersonRef } from './people';

withDefaults(defineProps<{ people: PersonRef[]; size?: number; ring?: string; overlap?: number; max?: number }>(), {
  size: 30,
  ring: 'var(--bg)',
  overlap: 7,
  max: 5,
});
</script>

<template>
  <div class="stack" :style="{ paddingLeft: `${overlap}px` }">
    <UiAvatar
      v-for="person in people.slice(0, max)"
      :key="person.id"
      :person="person"
      :size="size"
      :ring="ring"
      :style="{ marginLeft: `-${overlap}px` }"
    />
    <span v-if="people.length > max" class="stack__more mono" :style="{ marginLeft: '4px' }">+{{ people.length - max }}</span>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  align-items: center;
}
.stack__more {
  font-size: 11px;
  font-weight: 700;
  color: var(--mute);
}
</style>
