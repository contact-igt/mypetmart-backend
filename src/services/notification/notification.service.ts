import { UniqueConstraintError } from "sequelize";

import { DATABASE_TABLE_NAMES, type NotificationEntityType, type NotificationEventType } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { NotificationLog } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { maskEmail } from "../auth-challenge/auth-challenge.service.js";
import { logger } from "../../utils/logger.js";
import { emailService, type EmailSendOptions } from "../email/email.service.js";

type NotifyParams = {
  eventType: NotificationEventType;
  entityType: NotificationEntityType;
  entityId: number;
  recipientEmail: string | null;
  /**
   * Builds the email content lazily, AFTER the dedupe claim row is already
   * committed — so a caller can safely re-verify the entity is still in the
   * expected state here and return null to abort (recorded as "skipped",
   * never sent) without any risk of a duplicate send racing it.
   */
  build: () => Pick<EmailSendOptions, "subject" | "text" | "html"> | null | Promise<Pick<EmailSendOptions, "subject" | "text" | "html"> | null>;
};

/**
 * Backend-authoritative transactional notification dispatch. Callers invoke
 * this AFTER their own commerce transaction has already committed (see the
 * call sites in payment-finalization.service.ts, order.service.ts, etc.) —
 * this function never mutates commerce state and never throws, so a broken
 * SMTP server or a raced duplicate delivery can never affect the Order/
 * Payment/Refund/Return/Replacement transaction that triggered it.
 *
 * Idempotency is durable, not in-memory: a claim row is INSERTed into
 * notification_log (unique on event_type+entity_type+entity_id) BEFORE the
 * email is built or sent. A concurrent or replayed call for the same event
 * loses that INSERT (UniqueConstraintError) and returns immediately without
 * sending — this holds even across process restarts, unlike an in-memory
 * Set. See NOTIFICATION_EVENT_TYPE_VALUES in database.constants.ts for the
 * full event vocabulary and what entity_id means per event.
 */
export const NotificationService = {
  async notify(params: NotifyParams): Promise<void> {
    const { eventType, entityType, entityId, recipientEmail } = params;
    const logContext = { eventType, entityType, entityId };

    if (!recipientEmail) {
      logger.warn(logContext, "notification: no recipient email on record, skipped");
      return;
    }

    let logId: number;
    try {
      logId = await sequelize.transaction(async (t) => {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.notificationLog, t);
        await NotificationLog.create(
          { id, event_type: eventType, entity_type: entityType, entity_id: entityId, recipient_email: recipientEmail, status: "pending" },
          { transaction: t }
        );
        return id;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        logger.info(logContext, "notification: already claimed/sent for this event, skipping duplicate");
        return;
      }
      logger.error({ ...logContext, err: error }, "notification: failed to durably claim dedupe row, skipping send to avoid a duplicate risk");
      return;
    }

    try {
      const content = await params.build();
      if (!content) {
        await NotificationLog.update({ status: "skipped" }, { where: { id: logId } });
        return;
      }

      const sent = await emailService.sendEmail({ to: recipientEmail, ...content });
      await NotificationLog.update({ status: sent ? "sent" : "failed" }, { where: { id: logId } });
      logger.info({ ...logContext, recipient: maskEmail(recipientEmail), sent }, "notification: dispatch attempted");
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown notification error";
      logger.error({ ...logContext, err: error }, "notification: build/send failed");
      await NotificationLog.update({ status: "failed", error_message: message }, { where: { id: logId } }).catch(() => {
        // Bookkeeping only — the claim row already exists and stays "pending"
        // if even this update fails, which is fine: it still permanently
        // blocks a future duplicate send for the same event.
      });
    }
  }
};
