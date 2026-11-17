<script setup lang="ts">
import { computed } from 'vue';
import { initials, personColor, type PersonRef } from './people';

const props = withDefaults(
  defineProps<{
    person: PersonRef;
    size?: number;
    /** Colour of the 2px ring that separates stacked avatars; "none" drops it. */
    ring?: string;
  }>(),
  { size: 26, ring: 'none' },
);

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.42)}px`,
  background: personColor(props.person.id),
  border: props.ring === 'none' ? '0' : `2px solid ${props.ring}`,
}));
</script>

<template>
  <span class="av" :style="style" :title="person.name">
    <img v-if="person.avatar" :src="person.avatar" :alt="person.name" />
    <template v-else>{{ initials(person.name) }}</template>
  </span>
</template>

<style scoped>
.av {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  line-height: 1;
  overflow: hidden;
  box-sizing: border-box;
}
.av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
