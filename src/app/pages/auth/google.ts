import { GOOGLE_SIGN_IN_ERRORS, GOOGLE_SIGN_IN_PATH, type GoogleSignInError } from '../../../features/auth/web';

/** What the Google button tells the person when sign-in cannot start or came back refused. */
export const GOOGLE_DISABLED_MESSAGE = 'Masuk dengan Google belum diaktifkan di server ini. Pakai email dan password.';
const GOOGLE_FAILED_MESSAGE = 'Google belum bisa dihubungi. Cek koneksi lalu coba lagi.';

const GOOGLE_ERROR_MESSAGES: Record<GoogleSignInError, string> = {
  state: 'Sesi masuk Google sudah kedaluwarsa. Coba lagi.',
  denied: 'Masuk dengan Google dibatalkan.',
  unavailable: 'Google sedang tidak bisa dihubungi. Coba lagi sebentar lagi.',
  unverified: 'Email Google kamu belum terverifikasi oleh Google.',
  'registration-closed': 'Pendaftaran akun baru sedang ditutup. Minta admin membuatkan akun untukmu.',
};

/** The message for `/login?google-error=<reason>`, or nothing when the query is absent or unknown. */
export function googleErrorMessage(reason: unknown): string {
  return GOOGLE_SIGN_IN_ERRORS.find((known) => known === reason) ? GOOGLE_ERROR_MESSAGES[reason as GoogleSignInError] : '';
}

/**
 * Starts Google sign-in. The start route is a browser navigation that
 * redirects to Google, but answers 404 GOOGLE_DISABLED when the server has no
 * Google settings, so it is asked first without following the redirect: a
 * redirect means go, a refusal is shown on the page instead of raw JSON.
 * Resolves with the message to show, or '' once the browser is leaving.
 */
export async function startGoogleSignIn(navigate = (path: string) => window.location.assign(path)): Promise<string> {
  try {
    const response = await fetch(GOOGLE_SIGN_IN_PATH, { redirect: 'manual', credentials: 'same-origin' });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      navigate(GOOGLE_SIGN_IN_PATH);
      return '';
    }
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    return body?.code === 'GOOGLE_DISABLED' ? GOOGLE_DISABLED_MESSAGE : GOOGLE_FAILED_MESSAGE;
  } catch (error) {
    console.error(error);
    return GOOGLE_FAILED_MESSAGE;
  }
}
