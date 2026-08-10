import { QueryTypes, type Transaction } from "sequelize";

import { sequelize } from "../../database/index.js";
import { ProductSkuConflictError, ProductVariantSkuConflictError } from "./product.errors.js";

export const SKU_REGEX = /^[A-Z0-9._-]+$/;
export const MAX_SKU_LENGTH = 100;

export function normalizeAndValidateSku(rawSku: string): string {
  if (typeof rawSku !== "string") {
    throw new Error("SKU must be a string.");
  }
  const normalized = rawSku.trim().toUpperCase();
  if (!normalized) {
    throw new Error("SKU cannot be empty.");
  }
  if (normalized.length > MAX_SKU_LENGTH) {
    throw new Error(`SKU exceeds maximum allowed length of ${MAX_SKU_LENGTH} characters.`);
  }
  if (!SKU_REGEX.test(normalized)) {
    throw new Error("SKU contains invalid characters. Allowed characters: A-Z, 0-9, dash, underscore, dot.");
  }
  return normalized;
}

export function generateDuplicateSku(sourceSku: string, newId: number): string {
  const normalized = normalizeAndValidateSku(sourceSku);
  const suffix = `-COPY-${newId}`;
  const allowedBaseLength = MAX_SKU_LENGTH - suffix.length;
  const base = normalized.length > allowedBaseLength ? normalized.slice(0, allowedBaseLength) : normalized;
  return `${base}${suffix}`;
}

export function generateDuplicateSlug(sourceSlug: string, newId: number): string {
  const suffix = `-copy-${newId}`;
  const maxSlugLength = 190;
  const allowedBaseLength = maxSlugLength - suffix.length;
  const base = sourceSlug.length > allowedBaseLength ? sourceSlug.slice(0, allowedBaseLength) : sourceSlug;
  return `${base}${suffix}`;
}

export async function isSkuAvailable(sku: string, transaction?: Transaction): Promise<boolean> {
  const normalized = normalizeAndValidateSku(sku);
  const rows = await sequelize.query<{ sku: string }>(
    "SELECT `sku` FROM `catalog_sku_reservations` WHERE `sku` = ? LIMIT 1",
    {
      replacements: [normalized],
      type: QueryTypes.SELECT,
      ...(transaction ? { transaction } : {})
    }
  );
  return rows.length === 0;
}

export async function reserveSku(
  sku: string,
  entityType: "product" | "variant",
  entityId: number,
  transaction: Transaction
): Promise<string> {
  const normalized = normalizeAndValidateSku(sku);

  // Check if reservation already exists for this exact entity and SKU (e.g. idempotency or no-op SKU edit)
  const existing = await sequelize.query<{ sku: string; entity_type: string; entity_id: number }>(
    "SELECT `sku`, `entity_type`, `entity_id` FROM `catalog_sku_reservations` WHERE `sku` = ? LIMIT 1",
    {
      replacements: [normalized],
      type: QueryTypes.SELECT,
      transaction
    }
  );

  if (existing.length > 0) {
    const record = existing[0];
    if (record && record.entity_type === entityType && record.entity_id === entityId) {
      return normalized; // Already reserved by this entity
    }
    if (entityType === "product") {
      throw new ProductSkuConflictError(normalized);
    } else {
      throw new ProductVariantSkuConflictError(normalized);
    }
  }

  try {
    await sequelize.query(
      "INSERT INTO `catalog_sku_reservations` (`sku`, `entity_type`, `entity_id`, `reserved_at`) VALUES (?, ?, ?, NOW())",
      {
        replacements: [normalized, entityType, entityId],
        type: QueryTypes.INSERT,
        transaction
      }
    );
  } catch (_err: unknown) {
    if (entityType === "product") {
      throw new ProductSkuConflictError(normalized);
    } else {
      throw new ProductVariantSkuConflictError(normalized);
    }
  }

  return normalized;
}
