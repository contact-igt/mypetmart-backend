import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes, type Sequelize } from "sequelize";

import {
  DATABASE_TABLE_NAMES,
  NOTIFICATION_ENTITY_TYPE_VALUES,
  NOTIFICATION_EVENT_TYPE_VALUES,
  NOTIFICATION_STATUS_VALUES,
  type NotificationEntityType,
  type NotificationEventType,
  type NotificationStatus
} from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, numericPrimaryKeyAttribute } from "../table-helpers.js";

export class NotificationLog extends Model<InferAttributes<NotificationLog>, InferCreationAttributes<NotificationLog>> {
  declare id: CreationOptional<number>;
  declare event_type: NotificationEventType;
  declare entity_type: NotificationEntityType;
  declare entity_id: number;
  declare recipient_email: string;
  declare status: CreationOptional<NotificationStatus>;
  declare error_message: string | null;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initializeNotificationLogTable(sequelize: Sequelize): typeof NotificationLog {
  if (isModelInitialized(NotificationLog)) {
    return NotificationLog;
  }

  NotificationLog.init(
    {
      id: numericPrimaryKeyAttribute(),
      event_type: { type: DataTypes.ENUM(...NOTIFICATION_EVENT_TYPE_VALUES), allowNull: false },
      entity_type: { type: DataTypes.ENUM(...NOTIFICATION_ENTITY_TYPE_VALUES), allowNull: false },
      entity_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      recipient_email: { type: DataTypes.STRING(190), allowNull: false, validate: { isEmail: true, notEmpty: true, len: [3, 190] } },
      status: { type: DataTypes.ENUM(...NOTIFICATION_STATUS_VALUES), allowNull: false, defaultValue: "pending" },
      error_message: { type: DataTypes.STRING(500), allowNull: true },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.notificationLog, "NotificationLog", false),
      indexes: [
        { unique: true, fields: ["event_type", "entity_type", "entity_id"], name: "notification_log_event_entity_unique" },
        { fields: ["status"], name: "notification_log_status_idx" },
        { fields: ["created_at"], name: "notification_log_created_at_idx" }
      ]
    }
  );

  return NotificationLog;
}
