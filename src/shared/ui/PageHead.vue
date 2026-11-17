<script setup lang="ts">
/** Page head pattern: big title + one-line description left, optional middle control, actions right. */
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <header class="head">
    <div class="head__titles">
      <h1 class="head__title">{{ title }}</h1>
      <p v-if="description || $slots.description" class="head__desc"><slot name="description">{{ description }}</slot></p>
    </div>
    <div v-if="$slots.middle" class="head__middle"><slot name="middle" /></div>
    <div v-if="$slots.actions" class="head__acts"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  padding: 24px 28px 18px;
  flex-wrap: wrap;
}
.head__titles {
  min-width: 0;
}
.head__title {
  margin: 0;
  font-size: 38px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.head__desc {
  margin: 8px 0 0;
  font-size: 13.5px;
  color: var(--mute);
}
.head__middle {
  margin-bottom: 2px;
}
.head__acts {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (max-width: 760px) {
  .head {
    padding: 14px 16px 12px;
    gap: 12px;
  }
  .head__title {
    font-size: 30px;
  }
  .head__acts {
    margin-left: 0;
    flex-wrap: wrap;
  }
}
</style>
