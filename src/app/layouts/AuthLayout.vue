<script setup lang="ts">
import { StatusBlock } from '../../features/projects/web';
import { UiIcon } from '../../shared/ui';
import MacromaLogo from './MacromaLogo.vue';

/** Sign-in screens: ink story panel on the left (hidden on phones), the form centred on the right. */
const SAMPLE = [
  { version: 'v2.3.5', from: 'ongoing', to: 'review', when: 'baru saja' },
  { version: 'v2.3.4', from: 'revisi', to: 'ongoing', when: '2 jam lalu' },
  { version: 'v2.3.3', from: 'review', to: 'revisi', when: 'kemarin' },
] as const;
</script>

<template>
  <div class="auth">
    <aside class="auth__story">
      <MacromaLogo :size="22" />
      <div class="auth__pitch">
        <h1>Kanban yang<br />ingat setiap<br />versi.</h1>
        <p>Tiap task punya nomor versi dan catatan. Tiap batch jadi satu rilis.</p>
        <ul class="auth__log" aria-hidden="true">
          <li v-for="row in SAMPLE" :key="row.version">
            <span class="mono auth__ver">{{ row.version }}</span>
            <StatusBlock :status="row.from" />
            <UiIcon name="arrow" :size="14" :stroke="2.2" class="auth__arrow" />
            <StatusBlock :status="row.to" />
            <span class="auth__when">{{ row.when }}</span>
          </li>
        </ul>
      </div>
    </aside>
    <main class="auth__main">
      <div class="auth__phone-logo"><MacromaLogo :size="20" tone="page" /></div>
      <div class="auth__form"><slot /></div>
    </main>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
  display: flex;
  background: var(--card);
}
.auth__story {
  width: 620px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 44px 52px;
  background: var(--side-bg);
  color: var(--side-fg);
}
.auth__pitch {
  margin-top: auto;
}
.auth__pitch h1 {
  margin: 0;
  font-size: 58px;
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 0.98;
}
.auth__pitch p {
  max-width: 420px;
  margin: 18px 0 0;
  font-size: 16px;
  line-height: 1.5;
  color: #a9a7a1;
}
.auth__log {
  max-width: 440px;
  margin: 36px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.auth__log li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--r-card);
  background: var(--side-raise);
}
.auth__log li:nth-child(2) {
  opacity: 0.7;
}
.auth__log li:nth-child(3) {
  opacity: 0.45;
}
.auth__ver {
  width: 62px;
  font-size: 16px;
  font-weight: 700;
}
.auth__arrow {
  color: var(--block-dim);
}
.auth__when {
  margin-left: auto;
  font-size: 12px;
  color: var(--side-meta);
}
.auth__main {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 380px);
  place-content: center;
  padding: 32px 16px;
}
.auth__form {
  width: 100%;
}
.auth__phone-logo {
  display: none;
}
@media (max-width: 1000px) {
  .auth__story {
    display: none;
  }
  .auth__main {
    align-content: start;
    gap: 40px;
    padding-top: 28px;
  }
  .auth__phone-logo {
    display: block;
  }
}
</style>
