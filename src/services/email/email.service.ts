import nodemailer, { type Transporter, type SentMessageInfo } from "nodemailer";
import { environmentConfig } from "../../config/environment.config.js";
import { logger } from "../../utils/logger.js";
import { getEmailVerificationTemplate, getPasswordResetTemplate, getPasswordChangedTemplate, getNewsletterVerificationTemplate } from "./email.templates.js";
import { maskEmail } from "../auth-challenge/auth-challenge.service.js";

export type EmailSendOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export class EmailService {
  private transporter: Transporter<SentMessageInfo> | null = null;

  public constructor() {
    if (environmentConfig.SMTP_HOST && environmentConfig.SMTP_HOST.trim().length > 0) {
      this.transporter = nodemailer.createTransport({
        host: environmentConfig.SMTP_HOST,
        port: environmentConfig.SMTP_PORT,
        secure: environmentConfig.SMTP_SECURE,
        auth:
          environmentConfig.SMTP_USER && environmentConfig.SMTP_PASS
            ? {
                user: environmentConfig.SMTP_USER,
                pass: environmentConfig.SMTP_PASS
              }
            : undefined
      });
    }
  }

  /**
   * Verify SMTP connection is working.
   * Returns true if the transporter can connect and authenticate.
   */
  public async verify(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "Unknown verification error";
      logger.error({ smtpError: safeError }, "SMTP connection verification failed");
      return false;
    }
  }

  /**
   * Whether a real SMTP transporter is configured.
   */
  public hasTransporter(): boolean {
    return this.transporter !== null;
  }

  public async sendEmail(options: EmailSendOptions): Promise<boolean> {
    if (environmentConfig.NODE_ENV === "test") {
      logger.info(
        { recipient: maskEmail(options.to), subject: options.subject },
        "Email send mocked in test environment"
      );
      return true;
    }

    if (!this.transporter) {
      logger.warn(
        { recipient: maskEmail(options.to), subject: options.subject },
        "Email not sent: no SMTP transporter configured"
      );
      return false;
    }

    try {
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      const info = await this.transporter.sendMail({
        from: `"${environmentConfig.MAIL_FROM_NAME}" <${environmentConfig.MAIL_FROM_EMAIL}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html
      });

      logger.info(
        {
          recipient: maskEmail(options.to),
          subject: options.subject,
          messageId: info.messageId,
          accepted: info.accepted?.map((addr: string | { address: string; name: string }) => 
            typeof addr === "string" ? maskEmail(addr) : maskEmail(addr.address)
          ),
          rejected: info.rejected?.map((addr: string | { address: string; name: string }) => 
            typeof addr === "string" ? maskEmail(addr) : maskEmail(addr.address)
          ),
          response: info.response
        },
        "Email sent successfully"
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      return true;
    } catch (error: unknown) {
      const safeError = error instanceof Error ? error.message : "Unknown SMTP error";
      logger.error(
        { recipient: maskEmail(options.to), subject: options.subject, smtpError: safeError },
        "Email delivery failed"
      );
      return false;
    }
  }

  public async sendVerificationOTP(email: string, otp: string, ttlMinutes: number): Promise<boolean> {
    const template = getEmailVerificationTemplate(otp, ttlMinutes);
    return await this.sendEmail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html
    });
  }

  public async sendPasswordResetOTP(email: string, otp: string, ttlMinutes: number): Promise<boolean> {
    const template = getPasswordResetTemplate(otp, ttlMinutes);
    return await this.sendEmail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html
    });
  }

  public async sendNewsletterVerification(email: string, verifyUrl: string, ttlHours: number): Promise<boolean> {
    const template = getNewsletterVerificationTemplate(verifyUrl, ttlHours);
    return await this.sendEmail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html
    });
  }

  public async sendPasswordChangedNotification(email: string): Promise<boolean> {
    const template = getPasswordChangedTemplate();
    return await this.sendEmail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: template.html
    });
  }
}

export const emailService = new EmailService();
