<script setup lang="ts">
import { computed } from 'vue';
import UiIcon from './UiIcon.vue';
import type { IconName } from './icons';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'md' | 'sm' | 'lg';
    type?: 'button' | 'submit' | 'reset';
    icon?: IconName;
    block?: boolean;
    disabled?: boolean;
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', icon: undefined, block: false, disabled: false },
);

const classes = computed(() => [
  'btn',
  props.variant !== 'secondary' && `btn--${props.variant}`,
  props.size !== 'md' && `btn--${props.size}`,
  props.block && 'btn--block',
]);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled">
    <UiIcon v-if="icon" :name="icon" :stroke="2.2" />
    <slot />
  </button>
</template>
