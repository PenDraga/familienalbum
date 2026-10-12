import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Versand von E-Mails (Passwort-Reset). Ohne SMTP-Konfiguration ist `enabled` false und nichts wird verschickt. */
export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class NoopMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {}
}

/** Für Tests: merkt sich alle Nachrichten. */
export class RecordingMailer implements Mailer {
  readonly enabled = true;
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export class SmtpMailer implements Mailer {
  readonly enabled = true;
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }

  /** Verbindung und Anmeldung prüfen (beim Start, damit Konfigurationsfehler sofort auffallen). */
  verify(): Promise<true> {
    return this.transport.verify();
  }
}

/** SMTP_HOST gesetzt → SmtpMailer, sonst NoopMailer. */
export function mailerFromConfig(smtp: SmtpConfig | null): Mailer {
  return smtp ? new SmtpMailer(smtp) : new NoopMailer();
}
