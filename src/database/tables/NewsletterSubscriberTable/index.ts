import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES, NEWSLETTER_SUBSCRIBER_STATUS_VALUES, type NewsletterSubscriberStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";

export class NewsletterSubscriber extends Model<InferAttributes<NewsletterSubscriber>, InferCreationAttributes<NewsletterSubscriber>> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare normalized_email: string;
  declare status: CreationOptional<NewsletterSubscriberStatus>;
  declare source: string | null;
  declare verification_token_hash: string | null;
  declare verification_expires_at: Date | null;
  declare verification_sent_at: Date | null;
  declare verified_at: Date | null;
  declare unsubscribe_token_hash: string | null;
  declare unsubscribed_at: Date | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeNewsletterSubscriberTable(sequelize: Sequelize): typeof NewsletterSubscriber {
  if (isModelInitialized(NewsletterSubscriber)) {
    return NewsletterSubscriber;
  }

  NewsletterSubscriber.init(
    {
      id: numericPrimaryKeyAttribute(),
      email: { type: DataTypes.STRING(190), allowNull: false, validate: { isEmail: true, notEmpty: true, len: [3, 190] } },
      normalized_email: { type: DataTypes.STRING(190), allowNull: false, unique: true },
      status: { type: DataTypes.ENUM(...NEWSLETTER_SUBSCRIBER_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      source: { type: DataTypes.STRING(100), allowNull: true },
      verification_token_hash: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      verification_expires_at: { type: DataTypes.DATE, allowNull: true },
      verification_sent_at: { type: DataTypes.DATE, allowNull: true },
      verified_at: { type: DataTypes.DATE, allowNull: true },
      unsubscribe_token_hash: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      unsubscribed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.newsletterSubscribers, "NewsletterSubscriber", false),
      indexes: [
        { unique: true, fields: ["normalized_email"], name: "newsletter_subscribers_normalized_email_unique" },
        { unique: true, fields: ["verification_token_hash"], name: "newsletter_subscribers_verification_token_hash_unique" },
        { unique: true, fields: ["unsubscribe_token_hash"], name: "newsletter_subscribers_unsubscribe_token_hash_unique" },
        { fields: ["status"], name: "newsletter_subscribers_status_idx" },
        { fields: ["created_at"], name: "newsletter_subscribers_created_at_idx" }
      ]
    }
  );

  return NewsletterSubscriber;
}
