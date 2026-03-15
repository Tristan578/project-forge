export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface EmailProvider {
  send(options: EmailOptions): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(options: EmailOptions): Promise<void> {
    console.log("[EmailService] Sending email:", {
      to: options.to,
      from: options.from ?? "noreply@spawnforge.ai",
      subject: options.subject,
      text: options.text ?? "(no plain text)",
      html: options.html,
    });
  }
}

export function getEmailProvider(): EmailProvider {
  // Future: return new ResendEmailProvider() or new SendGridEmailProvider()
  // based on environment variables (e.g. process.env.EMAIL_PROVIDER)
  return new ConsoleEmailProvider();
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const provider = getEmailProvider();
  await provider.send(options);
}
