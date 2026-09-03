import { UniqueConstraintError } from "sequelize";

import { DATABASE_TABLE_NAMES, type NotificationEntityType, type NotificationEventType } from "../../constants/database.constants.js";
import { environmentConfig } from "../../config/environment.config.js";
import { sequelize } from "../../database/index.js";
import { NotificationLog } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { logger } from "../../utils/logger.js";
import { emailService } from "../email/email.service.js";
import type { EmailTemplate } from "../email/admin-email.templates.js";

// A very small, permissive shape check — the real validation is the mail
// server's own recipient handling. This only drops entries that clearly are
// not addresses so one typo in the ops config cannot poison the whole batch.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parses ADMIN_NOTIFICATION_EMAILS: comma-separated, trimmed, blanks removed,
 * case-insensitively de-duplicated, obvious non-addresses dropped. Returns []
 * when nothing usable is configured.
 */
export function parseAdminRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim();
    if (!email || !LOOKS_LIKE_EMAIL.test(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }
  return result;
}

type AdminNotifyParams = {
  eventType: NotificationEventType;
  entityType: NotificationEntityType;
  entityId: number;
  /**
   * Built lazily, AFTER the dedupe claim row is committed — a caller can
   * re-verify the entity is still in the expected state and return null to
   * abort (recorded "skipped", never sent).
   */
  build: () => EmailTemplate | null | Promise<EmailTemplate | null>;
};

/**
 * Operational admin-team email dispatch — the exact same durable, crash-safe
 * idempotency model as NotificationService.notify (a notification_log claim
 * row INSERTed BEFORE the email is built/sent; a replayed/raced call loses the
 * UNIQUE (event_type, entity_type, entity_id) INSERT and skips), but:
 *   - the event_type is always an ADMIN_* value, so the admin claim never
 *     collides with the customer claim for the same underlying event;
 *   - one email is sent to ALL configured recipients in a single message, and
 *     the claim row stores the first recipient (a real address) for audit;
 *   - a missing ADMIN_NOTIFICATION_EMAILS config is a safe skip + a logged
 *     warning, never an error — a commerce transaction that already committed
 *     must never be affected by admin-email configuration or delivery.
 *
 * Callers invoke this AFTER their commerce transaction has committed (from the
 * same CommerceNotifications post-commit boundary the customer emails use). It
 * never throws and never touches commerce state.
 */
export const AdminNotificationService = {
  resolveRecipients(): string[] {
    return parseAdminRecipients(environmentConfig.ADMIN_NOTIFICATION_EMAILS);
  },

  async notify(params: AdminNotifyParams): Promise<void> {
    const { eventType, entityType, entityId } = params;
    const logContext = { eventType, entityType, entityId, audience: "admin" as const };

    const recipients = AdminNotificationService.resolveRecipients();
    if (recipients.length === 0) {
      logger.warn(logContext, "admin notification: ADMIN_NOTIFICATION_EMAILS is not configured, skipping (commerce unaffected)");
      return;
    }

    let logId: number;
    try {
      logId = await sequelize.transaction(async (t) => {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.notificationLog, t);
        await NotificationLog.create(
          { id, event_type: eventType, entity_type: entityType, entity_id: entityId, recipient_email: recipients[0]!, status: "pending" },
          { transaction: t }
        );
        return id;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        logger.info(logContext, "admin notification: already claimed/sent for this event, skipping duplicate");
        return;
      }
      logger.error({ ...logContext, err: error }, "admin notification: failed to durably claim dedupe row, skipping send to avoid a duplicate risk");
      return;
    }

    try {
      const content = await params.build();
      if (!content) {
        await NotificationLog.update({ status: "skipped" }, { where: { id: logId } });
        return;
      }

      const sent = await emailService.sendEmail({ to: recipients.join(", "), subject: content.subject, text: content.text, html: content.html });
      await NotificationLog.update({ status: sent ? "sent" : "failed" }, { where: { id: logId } });
      logger.info({ ...logContext, recipientCount: recipients.length, sent }, "admin notification: dispatch attempted");
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown admin notification error";
      // Deliberately no email body / recipient list in the error log.
      logger.error({ ...logContext, errorMessage: message }, "admin notification: build/send failed");
      await NotificationLog.update({ status: "failed", error_message: message }, { where: { id: logId } }).catch(() => {
        // Bookkeeping only — the claim row already permanently blocks a duplicate.
      });
    }
  }
};
