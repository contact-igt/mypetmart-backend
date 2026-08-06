import { DataTypes, Model, type CreationOptional, type ForeignKey, type InferAttributes, type InferCreationAttributes, type NonAttribute, type Sequelize } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../../constants/database.constants.js";
import { isModelInitialized, timestampModelOptions, uuidPrimaryKeyAttribute } from "../table-helpers.js";
import type { ReturnRequest } from "../ReturnRequestTable/index.js";
import type { User } from "../UserTable/index.js";

export class ReturnNote extends Model<InferAttributes<ReturnNote>, InferCreationAttributes<ReturnNote>> {
  declare id: CreationOptional<string>;
  declare return_request_id: ForeignKey<ReturnRequest["id"]>;
  declare admin_id: ForeignKey<User["id"]>;
  declare message: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;

  declare returnRequest?: NonAttribute<ReturnRequest>;
  declare author?: NonAttribute<User>;
}

export function initializeReturnNoteTable(sequelize: Sequelize): typeof ReturnNote {
  if (isModelInitialized(ReturnNote)) {
    return ReturnNote;
  }

  ReturnNote.init(
    {
      id: uuidPrimaryKeyAttribute(),
      return_request_id: { type: DataTypes.UUID, allowNull: false },
      admin_id: { type: DataTypes.UUID, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true } },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      sequelize,
      ...timestampModelOptions(DATABASE_TABLE_NAMES.returnNotes, "ReturnNote", false),
      indexes: [
        { fields: ["return_request_id", "created_at"], name: "return_notes_return_request_created_at_idx" },
        { fields: ["admin_id"], name: "return_notes_admin_id_idx" }
      ]
    }
  );

  return ReturnNote;
}