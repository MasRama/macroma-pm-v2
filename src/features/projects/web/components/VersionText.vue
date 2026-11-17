<script setup lang="ts">
import { computed } from 'vue';
import type { BatchVersion, TaskVersion } from '../view';

const props = withDefaults(
  defineProps<{
    version: BatchVersion | TaskVersion;
    /** Card style: the patch digit is muted ("v2.3." ink + "4" mute). */
    mutePatch?: boolean;
  }>(),
  { mutePatch: false },
);

const patch = computed(() => ('patch' in props.version ? props.version.patch : undefined));
</script>

<template>
  <span class="ver mono"
    >v{{ version.major }}.{{ version.minor
    }}<template v-if="patch !== undefined"
      >.<em v-if="mutePatch && patch > 0" class="ver__patch">{{ patch }}</em
      ><template v-else>{{ patch }}</template></template
    ></span
  >
</template>

<style scoped>
.ver {
  white-space: nowrap;
}
.ver__patch {
  font-style: normal;
  color: var(--mute);
  font-weight: 500;
}
</style>
