<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { createAuthClient, createSecurityClient, SESSION_ENDED_REASON, useAuthSession } from '../../../features/auth/web';
import { TextField, UiButton } from '../../../shared/ui';
import AuthLayout from '../../layouts/AuthLayout.vue';
import GoogleMark from './GoogleMark.vue';
import { googleErrorMessage, startGoogleSignIn } from './google';
import { firstErrors, redirectTarget } from './redirect';
import './auth-form.css';

const email = ref('');
const password = ref('');
const code = ref('');
const useRecovery = ref(false);
const step = ref<'password' | 'two-factor'>('password');
const busy = ref(false);
const googleBusy = ref(false);
const formError = ref('');
const errors = ref<Record<string, string>>({});

const authClient = createAuthClient();
const securityClient = createSecurityClient();
const authSession = useAuthSession();
const route = useRoute();
const router = useRouter();
/** Apps that close registration route no Daftar page, so the link goes too. */
const canRegister = router.hasRoute('register');

async function finish(): Promise<void> {
  if (!(await authSession.refresh())) {
    formError.value = 'Berhasil masuk, tapi sesi belum bisa dimuat. Coba muat ulang halaman.';
    return;
  }
  await router.replace(redirectTarget(route));
}

async function focusCode(): Promise<void> {
  await nextTick();
  document.getElementById('login-code')?.focus();
}

async function submitPassword(): Promise<void> {
  if (busy.value) return;
  formError.value = '';
  errors.value = {};
  if (!email.value.trim()) errors.value.email = 'Email wajib diisi';
  if (!password.value) errors.value.password = 'Password wajib diisi';
  if (Object.keys(errors.value).length) return;

  busy.value = true;
  try {
    const response = await authClient.login({ email: email.value.trim(), password: password.value });
    if (!response.success) {
      formError.value = response.message;
      errors.value = firstErrors(response.errors);
      return;
    }
    if (response.data?.twoFactorRequired) {
      password.value = '';
      step.value = 'two-factor';
      await focusCode();
      return;
    }
    await finish();
  } catch (error) {
    console.error(error);
    formError.value = 'Tidak bisa masuk. Cek koneksi lalu coba lagi.';
  } finally {
    busy.value = false;
  }
}

async function submitCode(): Promise<void> {
  if (busy.value) return;
  formError.value = '';
  errors.value = {};
  const value = code.value.trim();
  if (!value) {
    errors.value.code = 'Kode wajib diisi';
    return;
  }

  busy.value = true;
  try {
    const response = await securityClient.completeTwoFactor(useRecovery.value ? { recovery_code: value } : { code: value });
    if (!response.success) {
      if (response.code === 'TWO_FACTOR_CHALLENGE_EXPIRED' || response.code === 'TWO_FACTOR_LOCKED') startOver();
      else code.value = '';
      formError.value = response.message;
      const fieldErrors = firstErrors(response.errors);
      errors.value = { code: fieldErrors.code ?? fieldErrors.recovery_code ?? '' };
      return;
    }
    await finish();
  } catch (error) {
    console.error(error);
    formError.value = 'Kode belum bisa dicek. Coba lagi.';
  } finally {
    busy.value = false;
  }
}

async function toggleRecovery(): Promise<void> {
  useRecovery.value = !useRecovery.value;
  code.value = '';
  formError.value = '';
  errors.value = {};
  await focusCode();
}

function startOver(): void {
  step.value = 'password';
  useRecovery.value = false;
  code.value = '';
  errors.value = {};
  // A Google sign-in that asked for the code lands on ?two-factor=1; starting over leaves it.
  if (route.query['two-factor']) void router.replace({ name: 'login', query: { ...route.query, 'two-factor': undefined } });
}

async function google(): Promise<void> {
  if (googleBusy.value) return;
  formError.value = '';
  googleBusy.value = true;
  formError.value = await startGoogleSignIn();
  // Leaving for Google keeps the button busy until the page unloads.
  if (formError.value) googleBusy.value = false;
}

onMounted(() => {
  // Google comes back here when the account needs its second factor, or refused.
  if (route.query['two-factor'] === '1') {
    step.value = 'two-factor';
    void focusCode();
  }
  formError.value = googleErrorMessage(route.query['google-error']);
});
</script>

<template>
  <AuthLayout>
    <template v-if="step === 'password'">
      <h1 class="af-title">Masuk</h1>
      <p v-if="canRegister" class="af-sub">Belum punya akun? <RouterLink class="link" :to="{ name: 'register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }">Daftar</RouterLink></p>
      <p v-if="route.query.reason === SESSION_ENDED_REASON" role="status" class="af-notice">Sesi kamu sudah berakhir. Masuk lagi untuk lanjut.</p>
      <p v-else-if="route.query.reset === '1'" role="status" class="af-notice" data-testid="reset-done">Password baru tersimpan. Masuk dengan password itu.</p>
      <UiButton class="af-google" block :disabled="googleBusy" data-testid="google-sign-in" @click="google"><GoogleMark />Masuk dengan Google</UiButton>
      <div class="af-or">atau pakai email</div>
      <form class="af-form" novalidate @submit.prevent="submitPassword">
        <p v-if="formError" role="alert" class="af-alert">{{ formError }}</p>
        <TextField id="login-email" v-model="email" type="email" label="Email" size="lg" autocomplete="email" :error="errors.email" />
        <TextField id="login-password" v-model="password" type="password" label="Password" size="lg" autocomplete="current-password" :error="errors.password">
          <template #aside><RouterLink class="link af-aside" :to="{ name: 'forgot-password' }">Lupa password?</RouterLink></template>
        </TextField>
        <UiButton class="af-submit" variant="primary" size="lg" type="submit" block :disabled="busy">{{ busy ? 'Masuk…' : 'Masuk' }}</UiButton>
      </form>
    </template>

    <template v-else>
      <h1 class="af-title">Verifikasi dua langkah</h1>
      <p class="af-sub">
        {{ useRecovery ? 'Masukkan salah satu kode pemulihan kamu.' : 'Masukkan 6 digit kode dari aplikasi authenticator.' }}
      </p>
      <form class="af-form af-form--spaced" data-testid="two-factor-form" novalidate @submit.prevent="submitCode">
        <p v-if="formError" role="alert" class="af-alert">{{ formError }}</p>
        <TextField
          id="login-code"
          v-model="code"
          :label="useRecovery ? 'Kode pemulihan' : 'Kode'"
          size="lg"
          :inputmode="useRecovery ? 'text' : 'numeric'"
          autocomplete="one-time-code"
          :error="errors.code || undefined"
        />
        <UiButton class="af-submit" variant="primary" size="lg" type="submit" block :disabled="busy">{{ busy ? 'Memeriksa…' : 'Verifikasi' }}</UiButton>
      </form>
      <p class="af-foot">
        <button type="button" class="link" @click="toggleRecovery">{{ useRecovery ? 'Pakai kode authenticator' : 'Pakai kode pemulihan' }}</button>
        ·
        <button type="button" class="link" @click="startOver">Mulai lagi</button>
      </p>
    </template>
  </AuthLayout>
</template>
