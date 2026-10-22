import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import { BREEZE_WEBHOOK_EVENT_KIND_VALUES, BREEZE_WEBHOOK_EVENT_STATUS_VALUES, DATABASE_TABLE_NAMES, type BreezeWebhookEventKind, type BreezeWebhookEventStatus } from "../../../constants/database.constants.js";
import { isModelInitialized, numericPrimaryKeyAttribute, timestampModelOptions } from "../table-helpers.js";

// One row per authenticated Breeze webhook event. UNIQUE(event_kind, event_id)
// is the durable idempotency key; response_body/http_status are the exact
// acknowledgement returned, so a replay gets the same answer. `payload` holds
// the schema-validated body (never the API key) so an event that could not be
// processed yet (e.g. amount unit not configured) can be re-processed later
// without losing evidence of a captured payment.
export class BreezeWebhookEvent extends Model<InferAttributes<BreezeWebhookEvent>, InferCreationAttributes<BreezeWebhookEvent>> {
  declare id: CreationOptional<number>;
  declare event_id: string;
  declare event_kind: BreezeWebhookEventKind;
  declare event_name: string | null;
  declare session_public_id: string | null;
  declare status: CreationOptional<BreezeWebhookEventStatus>;
  declare outcome_code: string | null;
  declare http_status: number | null;
  declare response_body: unknown;
  declare payload: unknown;
  declare attempts: CreationOptional<number>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeBreezeWebhookEventTable(sequelize: Sequelize): typeof BreezeWebhookEvent {
  if (isModelInitialized(BreezeWebhookEvent)) {
    return BreezeWebhookEvent;
  }

  BreezeWebhookEvent.init(
    {
      id: numericPrimaryKeyAttribute(),
      event_id: { type: DataTypes.STRING(190), allowNull: false },
      event_kind: { type: DataTypes.ENUM(...BREEZE_WEBHOOK_EVENT_KIND_VALUES), allowNull: false },
      event_name: { type: DataTypes.STRING(80), allowNull: true },
      session_public_id: { type: DataTypes.STRING(64), allowNull: true },
      status: { type: DataTypes.ENUM(...BREEZE_WEBHOOK_EVENT_STATUS_VALUES), allowNull: false, defaultValue: "received" },
      outcome_code: { type: DataTypes.STRING(80), allowNull: true },
      http_status: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      response_body: { type: DataTypes.JSON, allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: false },
      attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.breezeWebhookEvents, "BreezeWebhookEvent", false),
      indexes: [
        { unique: true, fields: ["event_kind", "event_id"], name: "breeze_webhook_events_kind_event_id_unique" },
        { fields: ["session_public_id"], name: "breeze_webhook_events_session_idx" },
        { fields: ["status"], name: "breeze_webhook_events_status_idx" }
      ]
    }
  );

  return BreezeWebhookEvent;
}
