import { DataTypes, type Model, type ModelAttributes, type ModelStatic } from "sequelize";

export type SerializedModel = Record<string, unknown>;

export function numericPrimaryKeyAttribute() {
  return {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    autoIncrement: false,
    primaryKey: true,
    unique: true
  };
}

export function timestampModelOptions(tableName: string, modelName: string, paranoid: boolean) {
  return {
    modelName,
    tableName,
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    deletedAt: paranoid ? "deleted_at" : false,
    paranoid
  };
}

export function removeSensitiveFields(model: Model, fields: readonly string[]): SerializedModel {
  const values = { ...model.get({ plain: true }) } as SerializedModel;

  for (const field of fields) {
    delete values[field];
  }

  return values;
}

export function isNonNegativeDecimal(value: string | number): boolean {
  return Number(value) >= 0;
}

export function isPositiveDecimal(value: string | number): boolean {
  return Number(value) > 0;
}

export function assertNullableCompareAtPrice(compareAtPrice: string | null, price: string): void {
  if (compareAtPrice !== null && Number(compareAtPrice) < Number(price)) {
    throw new Error("Compare-at price must be greater than or equal to price.");
  }
}

export function isModelInitialized(model: ModelStatic<Model>): boolean {
  return model.sequelize !== undefined;
}

export type AttributeMap = ModelAttributes<Model>;