<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import './auth-form.css';

/*
 * Ask for a reset link. The backend has no reset endpoint yet (backend port,
 * phase 2), so the form validates and says so instead of pretending to send.
 */
const email = ref('');
const error = ref<string | undefined>();
const notice = ref('');

function submit(): void {
  notice.value = '';
  error.value = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? undefined : 'Masukkan email yang valid';
  if (!error.value) notice.value = 'Reset password lewat email belum tersedia.';
}
</script>

<template>
  <AuthLayout>
    <h1 class="af-title">Lupa password</h1>
    <p class="af-sub">Masukkan email akun kamu, kami kirim link untuk bikin password baru.</p>
    <form class="af-form af-form--spaced" novalidate @submit.prevent="submit">
      <p v-if="notice" role="status" class="af-alert">{{ notice }}</p>
      <TextField id="forgot-email" v-model="email" type="email" label="Email" size="lg" autocomplete="email" :error="error" />
      <UiButton class="af-submit" variant="primary" size="lg" type="submit" block>Kirim link reset</UiButton>
    </form>
    <p class="af-foot">Ingat password-nya? <RouterLink class="link" :to="{ name: 'login' }">Masuk</RouterLink></p>
  </AuthLayout>
</template>
