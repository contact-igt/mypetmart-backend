import { UniqueConstraintError, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductSpecification } from "../../database/tables/ProductSpecificationTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatAdminSpecificationDTO } from "./product.service.js";
import { DuplicateSpecificationLabelError, InvalidProductDataError, ProductNotFoundError, ProductSpecificationNotFoundError } from "./product.errors.js";
import { normalizeSpecificationLabel } from "./product.validation.js";
import type { AdminProductSpecificationJSON, CreateSpecificationInput, UpdateSpecificationInput } from "./product.types.js";

export class ProductSpecificationService {
  // Create Specification for a Product
  static async createSpecification(productId: number, input: CreateSpecificationInput): Promise<AdminProductSpecificationJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return await sequelize.transaction(async (t) => {
      await assertNoDuplicateLabel(productId, input.label, null, t);

      const specificationId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productSpecifications, t);

      try {
        const specification = await ProductSpecification.create(
          {
            id: specificationId,
            product_id: productId,
            label: input.label,
            value: input.value,
            display_order: input.displayOrder ?? specificationId
          },
          { transaction: t }
        );

        return formatAdminSpecificationDTO(specification);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new DuplicateSpecificationLabelError(input.label);
        }
        throw error;
      }
    });
  }

  // Update Specification
  static async updateSpecification(productId: number, specificationId: number, input: UpdateSpecificationInput): Promise<AdminProductSpecificationJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const specification = await ProductSpecification.findOne({ where: { id: specificationId, product_id: productId } });
    if (!specification) {
      throw new ProductSpecificationNotFoundError(specificationId);
    }

    return await sequelize.transaction(async (t) => {
      if (input.label !== undefined) {
        await assertNoDuplicateLabel(productId, input.label, specificationId, t);
      }

      const updates: Record<string, unknown> = {};
      if (input.label !== undefined) updates.label = input.label;
      if (input.value !== undefined) updates.value = input.value;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;

      try {
        await specification.update(updates, { transaction: t });
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new DuplicateSpecificationLabelError(input.label ?? specification.label);
        }
        throw error;
      }

      return formatAdminSpecificationDTO(specification);
    });
  }

  // Delete Specification (hard delete — Specifications carry no downstream references, matching Features)
  static async deleteSpecification(productId: number, specificationId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const specification = await ProductSpecification.findOne({ where: { id: specificationId, product_id: productId } });
    if (!specification) {
      throw new ProductSpecificationNotFoundError(specificationId);
    }

    await specification.destroy();
  }

  // Reorder Specifications
  static async reorderSpecifications(productId: number, orderedIds: number[]): Promise<AdminProductSpecificationJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const specifications = await ProductSpecification.findAll({ where: { product_id: productId } });
    const requestedIds = new Set(uniqueIds);

    if (specifications.length !== uniqueIds.length || specifications.some((specification) => !requestedIds.has(specification.id))) {
      throw new InvalidProductDataError("Specification reorder must include every record belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductSpecification.update({ display_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductSpecification.findAll({
        where: { product_id: productId },
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map(formatAdminSpecificationDTO);
    });
  }
}

// Case/whitespace-insensitive duplicate check ahead of the DB unique
// constraint (product_specifications_product_label_unique, which relies on
// the table's utf8mb4_unicode_ci collation for case-insensitivity — labels
// are always trimmed at the validation layer, so that constraint alone is
// race-safe). This pre-check exists purely for a clean typed error instead
// of a raw constraint violation on the common, non-racing path.
async function assertNoDuplicateLabel(productId: number, label: string, excludeSpecificationId: number | null, transaction: Transaction): Promise<void> {
  const normalized = normalizeSpecificationLabel(label);
  const existing = await ProductSpecification.findAll({ where: { product_id: productId }, transaction });
  const duplicate = existing.find(
    (row) => row.id !== excludeSpecificationId && normalizeSpecificationLabel(row.label) === normalized
  );
  if (duplicate) {
    throw new DuplicateSpecificationLabelError(label);
  }
}
