<script setup lang="ts">
/** The Macroma mark (white square, red centre) and wordmark. Tone "side" sits on ink, "page" on the light page. */
withDefaults(defineProps<{ size?: number; tone?: 'side' | 'page' }>(), { size: 19, tone: 'side' });
</script>

<template>
  <div class="logo" :class="`logo--${tone}`">
    <span class="logo__mark" aria-hidden="true" />
    <b :style="{ fontSize: `${size}px` }">macroma</b>
  </div>
</template>

<style scoped>
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo__mark {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: #fff;
  flex-shrink: 0;
}
.logo__mark::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 6px;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  background: var(--c-revisi);
}
.logo b {
  font-weight: 800;
  letter-spacing: -0.03em;
}
.logo--side b {
  color: var(--side-fg);
}
.logo--page .logo__mark {
  background: var(--primary-bg);
}
.logo--page .logo__mark::after {
  background: var(--c-revisi);
}
.logo--page b {
  color: var(--ink);
}
</style>
