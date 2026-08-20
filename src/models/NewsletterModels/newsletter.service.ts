import crypto from "node:crypto";
import { Op, UniqueConstraintError, type WhereOptions } from "sequelize";

import { environmentConfig } from "../../config/environment.config.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { NewsletterSubscriber } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { computeTokenHash } from "../../services/auth-challenge/auth-challenge.service.js";
import { emailService } from "../../services/email/email.service.js";
import {
  NewsletterEmailDeliveryFailedError,
  NewsletterInvalidUnsubscribeTokenError,
  NewsletterInvalidVerificationTokenError
} from "./newsletter.errors.js";
import type {
  AdminNewsletterSubscriberJSON,
  ListNewsletterSubscribersQuery,
  NewsletterResendUnsubscribeLinkResult,
  NewsletterSubscribeInput,
  NewsletterSubscribeResult,
  NewsletterSubscriberListResponse,
  NewsletterUnsubscribeResult,
  NewsletterVerifyResult
} from "./newsletter.types.js";

// Only used to soft-throttle repeat submissions of the same address, not exposed
// as an env knob — this is an operational nicety, not a business policy (unlike
// NEWSLETTER_VERIFICATION_TTL_HOURS, which genuinely needed to be configurable).
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const GENERIC_SUBSCRIBE_MESSAGE = "Check your inbox to confirm your subscription.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function toSafeSubscriberJSON(subscriber: NewsletterSubscriber): AdminNewsletterSubscriberJSON {
  return {
    id: subscriber.id,
    email: subscriber.email,
    status: subscriber.status,
    source: subscriber.source,
    verifiedAt: subscriber.verified_at ? subscriber.verified_at.toISOString() : null,
    unsubscribedAt: subscriber.unsubscribed_at ? subscriber.unsubscribed_at.toISOString() : null,
    createdAt: subscriber.created_at.toISOString()
  };
}

export const NewsletterService = {
  async subscribe(input: NewsletterSubscribeInput): Promise<NewsletterSubscribeResult> {
    const email = input.email.trim();
    const normalizedEmail = normalizeEmail(email);

    await sequelize.transaction(async (t) => {
      const subscriber = await NewsletterSubscriber.findOne({
        where: { normalized_email: normalizedEmail },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      // Already confirmed: no-op, and no re-send — the response message stays
      // generic either way so this endpoint can't be used to probe which
      // emails are already on the list.
      if (subscriber && subscriber.status === "subscribed") {
        return;
      }

      if (subscriber && subscriber.status === "pending" && subscriber.verification_sent_at) {
        const elapsedMs = Date.now() - subscriber.verification_sent_at.getTime();
        if (elapsedMs < RESEND_COOLDOWN_MS) {
          return;
        }
      }

      const rawToken = generateRawToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + environmentConfig.NEWSLETTER_VERIFICATION_TTL_HOURS * 60 * 60 * 1000);

      if (subscriber) {
        // Covers both "resend while pending" and "subscribe again after
        // unsubscribing" — both restart the same verification flow.
        subscriber.email = email;
        subscriber.status = "pending";
        subscriber.source = input.source ?? subscriber.source;
        subscriber.verification_token_hash = computeTokenHash(rawToken);
        subscriber.verification_expires_at = expiresAt;
        subscriber.verification_sent_at = now;
        subscriber.unsubscribed_at = null;
        await subscriber.save({ transaction: t });
      } else {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.newsletterSubscribers, t);
        try {
          await NewsletterSubscriber.create(
            {
              id,
              email,
              normalized_email: normalizedEmail,
              status: "pending",
              source: input.source ?? null,
              verification_token_hash: computeTokenHash(rawToken),
              verification_expires_at: expiresAt,
              verification_sent_at: now
            },
            { transaction: t }
          );
        } catch (error) {
          if (!(error instanceof UniqueConstraintError)) {
            throw error;
          }
          // Lost the race to a concurrent subscribe for the same email; that
          // request already owns sending the verification email.
          return;
        }
      }

      const verifyUrl = `${environmentConfig.STOREFRONT_ORIGIN}/newsletter/verify?token=${encodeURIComponent(rawToken)}`;
      const sent = await emailService.sendNewsletterVerification(email, verifyUrl, environmentConfig.NEWSLETTER_VERIFICATION_TTL_HOURS);
      if (!sent && environmentConfig.NODE_ENV !== "test") {
        throw new NewsletterEmailDeliveryFailedError();
      }
    });

    return { message: GENERIC_SUBSCRIBE_MESSAGE };
  },

  async verify(rawToken: string): Promise<NewsletterVerifyResult> {
    const tokenHash = computeTokenHash(rawToken);

    return sequelize.transaction(async (t) => {
      const subscriber = await NewsletterSubscriber.findOne({
        where: { status: "pending", verification_token_hash: tokenHash },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!subscriber || !subscriber.verification_expires_at || subscriber.verification_expires_at < new Date()) {
        throw new NewsletterInvalidVerificationTokenError();
      }

      const rawUnsubscribeToken = generateRawToken();
      const now = new Date();

      subscriber.status = "subscribed";
      subscriber.verified_at = now;
      subscriber.verification_token_hash = null;
      subscriber.verification_expires_at = null;
      subscriber.unsubscribed_at = null;
      subscriber.unsubscribe_token_hash = computeTokenHash(rawUnsubscribeToken);
      await subscriber.save({ transaction: t });

      return {
        message: "Thank you! You are now subscribed to the MyPetMart newsletter.",
        email: subscriber.email,
        unsubscribeToken: rawUnsubscribeToken
      };
    });
  },

  async unsubscribe(rawToken: string): Promise<NewsletterUnsubscribeResult> {
    const tokenHash = computeTokenHash(rawToken);

    return sequelize.transaction(async (t) => {
      const subscriber = await NewsletterSubscriber.findOne({
        where: { unsubscribe_token_hash: tokenHash },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!subscriber) {
        throw new NewsletterInvalidUnsubscribeTokenError();
      }

      subscriber.status = "unsubscribed";
      subscriber.unsubscribed_at = subscriber.unsubscribed_at ?? new Date();
      await subscriber.save({ transaction: t });

      return { message: "You have been unsubscribed from the MyPetMart newsletter." };
    });
  },

  async resendUnsubscribeLink(email: string): Promise<NewsletterResendUnsubscribeLinkResult> {
    const normalizedEmail = normalizeEmail(email);
    const genericResult: NewsletterResendUnsubscribeLinkResult = {
      message: "If that email is subscribed, we've sent a link to manage it."
    };

    await sequelize.transaction(async (t) => {
      const subscriber = await NewsletterSubscriber.findOne({
        where: { normalized_email: normalizedEmail, status: "subscribed" },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      // Same email-enumeration guard as subscribe(): identical response either way.
      if (!subscriber) {
        return;
      }

      const rawUnsubscribeToken = generateRawToken();
      subscriber.unsubscribe_token_hash = computeTokenHash(rawUnsubscribeToken);
      await subscriber.save({ transaction: t });

      const unsubscribeUrl = `${environmentConfig.STOREFRONT_ORIGIN}/newsletter/unsubscribe?token=${encodeURIComponent(rawUnsubscribeToken)}`;
      await emailService.sendEmail({
        to: subscriber.email,
        subject: "Manage your MyPetMart newsletter subscription",
        text: `Click the link below to unsubscribe from the MyPetMart newsletter:\n\n${unsubscribeUrl}\n\nIf you did not request this, you can safely ignore this email.`,
        html: `<p>Click the link below to unsubscribe from the MyPetMart newsletter:</p><p><a href="${unsubscribeUrl}">${unsubscribeUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p>`
      });
    });

    return genericResult;
  },

  async listSubscribers(query: ListNewsletterSubscribersQuery): Promise<NewsletterSubscriberListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const whereConditions: WhereOptions[] = [];
    if (query.status) {
      whereConditions.push({ status: query.status });
    }
    if (query.search) {
      whereConditions.push({ email: { [Op.like]: `%${query.search}%` } });
    }

    const { rows, count } = await NewsletterSubscriber.findAndCountAll({
      where: whereConditions.length > 0 ? { [Op.and]: whereConditions } : {},
      order: [["created_at", "DESC"]],
      limit,
      offset
    });

    return {
      items: rows.map(toSafeSubscriberJSON),
      pagination: {
        page,
        limit,
        totalItems: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
};
