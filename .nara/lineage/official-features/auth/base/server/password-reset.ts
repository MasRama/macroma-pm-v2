import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  type AuthSuccess,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from '../contract';
import { env } from '../../../shared/config';
import { Logger } from '../../../shared/logging';
import { jsonInput, publicRoute } from '../../../shared/security';
import type { AuthActivitySink } from './activity';
import { PASSWORD_RESET_TTL_MS } from './config';
import { sessionsChanged } from './live';
import { mailTransport } from './mail';
import { createPasswordResetToken, findUserByEmail, findUserById, redeemPasswordResetToken } from './repository';
import { hashPassword } from './service';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The browser page that reads the token and asks for the new password. */
export function passwordResetLink(token: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

const forgotPasswordHandler = (context: Context, input: ForgotPasswordInput) => {
  const user = findUserByEmail(input.email);
  if (user) {
    const token = randomBytes(32).toString('hex');
    createPasswordResetToken({
      id: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
    });
    const minutes = Math.round(PASSWORD_RESET_TTL_MS / 60_000);
    // Sent in the background: waiting for SMTP would tell the caller the account exists.
    void mailTransport()
      .send({
        to: user.email,
        subject: 'Reset your password',
        text: [
          `Hi ${user.name},`,
          '',
          'Someone asked to reset the password of your account. If it was you, open this link to choose a new one:',
          '',
          passwordResetLink(token),
          '',
          `The link works once, for ${minutes} minutes. If you did not ask for it, ignore this email: your password stays as it is.`,
        ].join('\n'),
      })
      .catch((error: unknown) =>
        Logger.error('Failed to send a password reset email', error instanceof Error ? error : { error: String(error) }),
      );
    Logger.logAuth('password_reset_requested', { userId: user.id });
  }
  return context.json({
    success: true as const,
    message: 'If an account uses this email, a reset link is on its way',
  } satisfies AuthSuccess);
};

const resetPasswordHandler = async (context: Context, input: ResetPasswordInput, activity?: AuthActivitySink) => {
  const userId = redeemPasswordResetToken(tokenHash(input.token), await hashPassword(input.password));
  if (!userId) {
    return context.json(
      { success: false as const, message: 'This reset link is invalid or has expired', code: 'RESET_TOKEN_INVALID' as const },
      400,
    );
  }
  // Every device was signed out with the old password.
  sessionsChanged([userId]);
  const user = findUserById(userId);
  Logger.logAuth('password_reset', { userId });
  activity?.({
    action: 'auth.password-reset',
    resource: 'auth',
    actorId: userId,
    targetId: userId,
    targetLabel: user?.name ?? null,
  });
  return context.json({
    success: true as const,
    message: 'Password reset. Sign in with your new password.',
  } satisfies AuthSuccess);
};

/** Forgotten passwords: a link by email, then a new password with its token. */
export function createPasswordResetRoutes(activity?: AuthActivitySink) {
  return new Hono()
    .post('/forgot-password', publicRoute, jsonInput(forgotPasswordInputSchema), (context) =>
      forgotPasswordHandler(context, context.req.valid('json')),
    )
    .post('/reset-password', publicRoute, jsonInput(resetPasswordInputSchema), (context) =>
      resetPasswordHandler(context, context.req.valid('json'), activity),
    );
}
