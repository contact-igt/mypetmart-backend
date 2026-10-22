import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { BREEZE_CHECKOUT_SESSION_STATUS_VALUES, BREEZE_SESSION_PROCESSING_STATUS_VALUES, DATABASE_TABLE_NAMES, type BreezeCheckoutSessionStatus, type BreezeSessionProcessingStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

// One row per server-signed Breeze startCheckout attempt. cart_snapshot is
// the exact Breeze Cart Object string that was signed; cart_hash is its
// SHA-256, so a webhook can be proven to belong to what MyPetMart offered.
// Never stores the private key or the signature.
export class BreezeCheckoutSession extends Model<InferAttributes<BreezeCheckoutSession>, InferCreationAttributes<BreezeCheckoutSession>> {
  declare id: CreationOptional<number>;
  declare public_id: string;
  declare user_id: number | null;
  declare guest_identity_hash: string | null;
  declare cart_id: number;
  declare status: CreationOptional<BreezeCheckoutSessionStatus>;
  declare cart_hash: string;
  declare amount_paise: number;
  declare currency: CreationOptional<string>;
  declare cart_snapshot: unknown;
  declare breeze_checkout_id: string | null;
  declare order_id: number | null;
  // Immutable order lines captured at signing time — the only source the
  // Order Create webhook may build an Order from (never the live cart).
  declare order_intent: unknown;
  declare breeze_cart_id: string | null;
  declare breeze_order_id: string | null;
  declare breeze_txn_id: string | null;
  declare payment_id: number | null;
  declare processing_status: CreationOptional<BreezeSessionProcessingStatus>;
  declare last_event_id: string | null;
  declare last_error_code: string | null;
  declare expires_at: Date;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeBreezeCheckoutSessionTable(sequelize: Sequelize): typeof BreezeCheckoutSession {
  if (isModelInitialized(BreezeCheckoutSession)) {
    return BreezeCheckoutSession;
  }

  BreezeCheckoutSession.init(
    {
      id: numericPrimaryKeyAttribute(),
      public_id: { type: DataTypes.STRING(64), allowNull: false },
      user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      guest_identity_hash: { type: DataTypes.STRING(64), allowNull: true },
      cart_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.ENUM(...BREEZE_CHECKOUT_SESSION_STATUS_VALUES), allowNull: false, defaultValue: "created" },
      cart_hash: { type: DataTypes.CHAR(64), allowNull: false },
      amount_paise: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "INR" },
      cart_snapshot: { type: DataTypes.JSON, allowNull: false },
      breeze_checkout_id: { type: DataTypes.STRING(190), allowNull: true },
      order_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      order_intent: { type: DataTypes.JSON, allowNull: true },
      breeze_cart_id: { type: DataTypes.STRING(190), allowNull: true },
      breeze_order_id: { type: DataTypes.STRING(190), allowNull: true },
      breeze_txn_id: { type: DataTypes.STRING(190), allowNull: true },
      payment_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      processing_status: { type: DataTypes.ENUM(...BREEZE_SESSION_PROCESSING_STATUS_VALUES), allowNull: false, defaultValue: "awaiting_webhook" },
      last_event_id: { type: DataTypes.STRING(190), allowNull: true },
      last_error_code: { type: DataTypes.STRING(80), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.breezeCheckoutSessions, "BreezeCheckoutSession", false),
      indexes: [
        { unique: true, fields: ["public_id"], name: "breeze_checkout_sessions_public_id_unique" },
        { unique: true, fields: ["order_id"], name: "breeze_checkout_sessions_order_id_unique" },
        { unique: true, fields: ["breeze_order_id"], name: "breeze_checkout_sessions_breeze_order_id_unique" },
        { unique: true, fields: ["breeze_txn_id"], name: "breeze_checkout_sessions_breeze_txn_id_unique" },
        { unique: true, fields: ["payment_id"], name: "breeze_checkout_sessions_payment_id_unique" },
        { fields: ["cart_id"], name: "breeze_checkout_sessions_cart_id_idx" },
        { fields: ["status", "expires_at"], name: "breeze_checkout_sessions_status_expires_idx" }
      ]
    }
  );

  return BreezeCheckoutSession;
}
