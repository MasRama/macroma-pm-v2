<script setup lang="ts">
import { RouterLink } from 'vue-router';
import MacromaLogo from '../layouts/MacromaLogo.vue';
</script>

<template>
  <main class="nf" data-testid="not-found-page">
    <MacromaLogo tone="page" />
    <div class="nf__copy">
      <span class="nf__code mono" aria-hidden="true">404</span>
      <h1>Halaman tidak ditemukan</h1>
      <p>Alamat ini tidak ada di Macroma. Board dan project kamu masih aman di tempatnya.</p>
      <RouterLink to="/dashboard" class="btn btn--primary btn--lg nf__back">Kembali ke Dashboard</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.nf {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 28px clamp(16px, 5vw, 56px);
  background: var(--bg);
  color: var(--ink);
}
.nf__copy {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  max-width: 520px;
}
.nf__code {
  display: inline-block;
  padding: 6px 12px;
  border-radius: var(--r-block);
  background: var(--c-revisi);
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}
.nf h1 {
  margin: 18px 0 0;
  font-size: clamp(30px, 5vw, 46px);
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.05;
}
.nf p {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--mute);
}
.nf__back {
  margin-top: 26px;
}
</style>
