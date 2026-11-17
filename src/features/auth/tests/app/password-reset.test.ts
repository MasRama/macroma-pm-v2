import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSecurityState } from '../../../../app/server';
import { signIn, signUp, TEST_PASSWORD } from '../../../../app/tests/personas';
import { getDatabase } from '../../../../shared/database';
import { csrfHeaders, issueCsrf } from '../../../../shared/security/tests/helpers';
import { useMailTransport, type MailMessage } from '../../server/mail';

const NEW_PASSWORD = 'a fresh and long passphrase';

async function post(path: string, body: unknown, cookie?: string) {
  const state = await issueCsrf(app, cookie);
  return app.request(`/api/auth${path}`, {
    method: 'POST',
    headers: { ...csrfHeaders(state), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function tokenFrom(message: MailMessage | undefined): string {
  const match = message?.text.match(/reset-password\?token=([a-f0-9]+)/);
  if (!match) throw new Error('No reset link in the email');
  return match[1];
}

describe('password reset by email', () => {
  let sent: MailMessage[];

  beforeEach(() => {
    sent = [];
    useMailTransport({ send: async (message) => void sent.push(message) });
  });

  afterEach(() => useMailTransport(undefined));

  it('answers the same for an unknown email and sends nothing', async () => {
    const response = await post('/forgot-password', { email: `${randomUUID()}@example.com` });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'If an account uses this email, a reset link is on its way',
    });
    expect(sent).toEqual([]);
  });

  it('mails a one-time link that sets a new password and signs out every device', async () => {
    const account = await signUp('Forgetful Person');
    const response = await post('/forgot-password', { email: account.email.toUpperCase() });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: account.email, subject: 'Reset your password' });
    const token = tokenFrom(sent[0]);
    // Only the token's hash is stored.
    expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM password_reset_tokens WHERE token_hash = ?').get(token)).toEqual({
      count: 0,
    });

    resetSecurityState();
    const reset = await post('/reset-password', { token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // The session from sign-up ended with the old password.
    expect((await app.request('/api/auth/me', { headers: { Cookie: account.cookie } })).status).toBe(401);
    await expect(signIn(account.email, TEST_PASSWORD)).rejects.toThrow('Sign-in failed with 401');
    resetSecurityState();
    await expect(signIn(account.email, NEW_PASSWORD)).resolves.toContain('auth_id=');

    resetSecurityState();
    const reused = await post('/reset-password', { token, password: 'yet another passphrase' });
    expect(reused.status).toBe(400);
    await expect(reused.json()).resolves.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
  });

  it('refuses an expired link and keeps only the latest one', async () => {
    const account = await signUp('Late Person');
    await post('/forgot-password', { email: account.email });
    await post('/forgot-password', { email: account.email });
    const [first, second] = sent.map(tokenFrom);

    resetSecurityState();
    expect((await post('/reset-password', { token: first, password: NEW_PASSWORD })).status).toBe(400);

    getDatabase().prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, account.id);
    const expired = await post('/reset-password', { token: second, password: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
    resetSecurityState();
    await expect(signIn(account.email, TEST_PASSWORD)).resolves.toContain('auth_id=');
  });

  it('validates the new password before touching the token', async () => {
    const response = await post('/reset-password', { token: 'abc', password: 'short' });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR', errors: { password: expect.any(Array) } });
  });

  it('counts both routes toward the strict per-client limit', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await post('/forgot-password', { email: `${randomUUID()}@example.com` })).status);
    }
    expect(statuses).toContain(429);

    resetSecurityState();
    const resets: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      resets.push((await post('/reset-password', { token: 'nope', password: NEW_PASSWORD })).status);
    }
    expect(resets).toContain(429);
  });
});
