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
 * Without SMTP settings (development, tests) nothing is sent. The log only
 * notes who the message was for and its subject: a body can hold a reset
 * link, and whoever reads the logs must not be able to use it. Only a
 * development server prints the message, on its own console, so a developer
 * can follow the link. Production never gets here: `mailAvailable()` is false
 * and routes that would send refuse instead.
 */
function logTransport(): MailTransport {
  return {
    send: async (message) => {
      Logger.info('Mail not sent: MAIL_HOST is not set', { to: message.to, subject: message.subject });
      if (env.NODE_ENV === 'development') {
        process.stdout.write(`\n--- Mail to ${message.to}: ${message.subject} ---\n${message.text}\n---\n\n`);
      }
    },
  };
}

let transport: MailTransport | undefined;
let replaced = false;

/** Whether mail can go out: SMTP is set up, a test replaced the transport, or this is not production. */
export function mailAvailable(): boolean {
  return replaced || Boolean(MAIL.host) || env.NODE_ENV !== 'production';
}

export function mailTransport(): MailTransport {
  transport ??= MAIL.host ? smtpTransport() : logTransport();
  return transport;
}

/** Replaces the transport, for tests that read what was sent; undefined restores the configured one. */
export function useMailTransport(next: MailTransport | undefined): void {
  transport = next;
  replaced = next !== undefined;
}
