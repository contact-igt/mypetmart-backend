import { DATABASE_TABLE_NAMES, type ProductMediaRole } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { MediaAsset } from "../../database/tables/MediaAssetTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductMediaAssignment } from "../../database/tables/ProductMediaAssignmentTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { assertVideoMediaAsset, formatMediaAssignmentDTO } from "./product.service.js";
import { InvalidProductDataError, ProductMediaAssignmentNotFoundError, ProductNotFoundError } from "./product.errors.js";
import type { CreateMediaAssignmentInput, ProductMediaAssignmentJSON, UpdateMediaAssignmentInput } from "./product.types.js";

export class ProductMediaAssignmentService {
  // Create Media Assignment for a Product
  static async createAssignment(productId: number, input: CreateMediaAssignmentInput): Promise<ProductMediaAssignmentJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    await assertVideoMediaAsset(input.mediaAssetId);

    return await sequelize.transaction(async (t) => {
      const assignmentId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productMediaAssignments, t);

      const assignment = await ProductMediaAssignment.create(
        {
          id: assignmentId,
          product_id: productId,
          media_asset_id: input.mediaAssetId,
          media_role: input.mediaRole,
          title: input.title ?? null,
          caption: input.caption ?? null,
          display_order: input.displayOrder ?? assignmentId,
          active: input.active ?? true
        },
        { transaction: t }
      );

      const withMedia = await ProductMediaAssignment.findByPk(assignment.id, {
        include: [{ model: MediaAsset, as: "mediaAsset" }],
        transaction: t
      });

      return formatMediaAssignmentDTO(withMedia!);
    });
  }

  // Update Media Assignment (title/caption/displayOrder/active — mediaRole is immutable)
  static async updateAssignment(productId: number, assignmentId: number, input: UpdateMediaAssignmentInput): Promise<ProductMediaAssignmentJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const assignment = await ProductMediaAssignment.findOne({
      where: { id: assignmentId, product_id: productId },
      include: [{ model: MediaAsset, as: "mediaAsset" }]
    });
    if (!assignment) {
      throw new ProductMediaAssignmentNotFoundError(assignmentId);
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.caption !== undefined) updates.caption = input.caption;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;
      if (input.active !== undefined) updates.active = input.active;

      await assignment.update(updates, { transaction: t });

      return formatMediaAssignmentDTO(assignment);
    });
  }

  // Delete Media Assignment (hard delete — never deletes the MediaAsset or its R2 object)
  static async deleteAssignment(productId: number, assignmentId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const assignment = await ProductMediaAssignment.findOne({ where: { id: assignmentId, product_id: productId } });
    if (!assignment) {
      throw new ProductMediaAssignmentNotFoundError(assignmentId);
    }

    await assignment.destroy();
  }

  // Reorder Media Assignments — scoped to a single role so reordering Product
  // Videos never touches Testimonial Videos display_order, and vice versa.
  static async reorderAssignments(productId: number, mediaRole: ProductMediaRole, orderedIds: number[]): Promise<ProductMediaAssignmentJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const assignments = await ProductMediaAssignment.findAll({ where: { product_id: productId, media_role: mediaRole } });
    const requestedIds = new Set(uniqueIds);

    if (assignments.length !== uniqueIds.length || assignments.some((assignment) => !requestedIds.has(assignment.id))) {
      throw new InvalidProductDataError("Media assignment reorder must include every record of this role belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductMediaAssignment.update(
          { display_order: i },
          { where: { id: uniqueIds[i], product_id: productId, media_role: mediaRole }, transaction: t }
        );
      }

      const reordered = await ProductMediaAssignment.findAll({
        where: { product_id: productId, media_role: mediaRole },
        include: [{ model: MediaAsset, as: "mediaAsset" }],
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map(formatMediaAssignmentDTO);
    });
  }
}
