import type { MailKind } from '@turnkeel/protocol';
import { createTransport } from 'nodemailer';
import type { Logger } from '../log.js';
import { messages } from '../messages.js';

/** One mail. Mail is plain text. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * The one way mail leaves the server. Version 1 sends two kinds: sign-in
 * links and invitations.
 */
export interface Mailer {
  /** `smtp` when mail is configured, `log` when the link goes to the server log. */
  readonly kind: MailKind;
  send(message: MailMessage): Promise<void>;
  close(): Promise<void>;
}

/** Sends through the SMTP server that `SMTP_URL` names, from `MAIL_FROM`. */
export function createSmtpMailer(options: { smtpUrl: string; from: string }): Mailer {
  const transport = createTransport(options.smtpUrl);
  return {
    kind: 'smtp',
    async send(message) {
      await transport.sendMail({
        from: options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
    close() {
      transport.close();
      return Promise.resolve();
    },
  };
}

/**
 * The fallback when `SMTP_URL` is not set: writes the recipient and the text, with
 * its link, to the server log, so a fresh install still has a way to sign in.
 */
export function createLogMailer(logger: Logger): Mailer {
  return {
    kind: 'log',
    send(message) {
      logger.info(messages.log.mailNotConfigured(message));
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}

/** The mailer the configuration asks for. */
export function createMailer(
  mail: { smtpUrl: string; from: string } | null,
  logger: Logger,
): Mailer {
  return mail === null ? createLogMailer(logger) : createSmtpMailer(mail);
}
