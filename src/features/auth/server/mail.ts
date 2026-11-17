import { createTransport } from 'nodemailer';
import { env } from '../../../shared/config';
import { Logger } from '../../../shared/logging';
import { MAIL } from './config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Delivers one message; rejects when it could not be handed over. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

function smtpTransport(): MailTransport {
  const transporter = createTransport({
    host: MAIL.host,
    port: MAIL.port,
    secure: MAIL.secure,
    ...(MAIL.user ? { auth: { user: MAIL.user, pass: MAIL.password ?? '' } } : {}),
  });
  return {
    send: async (message) => {
      await transporter.sendMail({ from: MAIL.from, to: message.to, subject: message.subject, text: message.text });
    },
  };
}

/**
 * Without SMTP settings (development, tests) the message goes to the log, so
 * links in it still work without any secret. Production is told it is
 * missing mail.
 */
function logTransport(): MailTransport {
  return {
    send: async (message) => {
      if (env.NODE_ENV === 'production') {
        Logger.warn('MAIL_HOST is not set: an email was written to the log instead of being sent', { to: message.to });
      }
      Logger.info('Mail (not sent: MAIL_HOST is not set)', { to: message.to, subject: message.subject, text: message.text });
    },
  };
}

let transport: MailTransport | undefined;

export function mailTransport(): MailTransport {
  transport ??= MAIL.host ? smtpTransport() : logTransport();
  return transport;
}

/** Replaces the transport, for tests that read what was sent; undefined restores the configured one. */
export function useMailTransport(next: MailTransport | undefined): void {
  transport = next;
}
