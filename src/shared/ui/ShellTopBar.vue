<script setup lang="ts">
/**
 * Puts a page's breadcrumb and tabs into the app shell's top bar. The shell
 * renders the #shell-topbar target; outside the shell nothing is shown.
 */
</script>

<template>
  <Teleport defer to="#shell-topbar">
    <slot />
  </Teleport>
</template>
