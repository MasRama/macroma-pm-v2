<script setup lang="ts">
import { ICONS, type IconName } from './icons';

withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), { size: 17, stroke: 1.8 });
</script>

<template>
  <svg
    class="ui-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    aria-hidden="true"
    focusable="false"
    v-html="ICONS[name]"
  />
</template>

<style scoped>
.ui-icon {
  flex-shrink: 0;
}
</style>
