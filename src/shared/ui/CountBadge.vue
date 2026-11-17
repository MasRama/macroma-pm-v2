<script setup lang="ts">
/** Small solid red count (Chat unread, notification header). */
defineProps<{ count: number; label?: string }>();
</script>

<template>
  <span class="badge mono" :aria-label="label">{{ count }}</span>
</template>

<style scoped>
.badge {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.45;
  background: var(--alert);
  color: #fff;
  border-radius: 5px;
  padding: 1px 6px;
}
</style>
