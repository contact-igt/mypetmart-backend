import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductFaq } from "../../database/tables/ProductFaqTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatAdminFaqDTO } from "./product.service.js";
import { InvalidProductDataError, ProductFaqNotFoundError, ProductNotFoundError } from "./product.errors.js";
import type { AdminProductFaqJSON, CreateFaqInput, UpdateFaqInput } from "./product.types.js";

export class ProductFaqService {
  // Create FAQ for a Product
  static async createFaq(productId: number, input: CreateFaqInput): Promise<AdminProductFaqJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return await sequelize.transaction(async (t) => {
      const faqId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productFaqs, t);

      const faq = await ProductFaq.create(
        {
          id: faqId,
          product_id: productId,
          question: input.question,
          answer: input.answer,
          display_order: input.displayOrder ?? faqId
        },
        { transaction: t }
      );

      return formatAdminFaqDTO(faq);
    });
  }

  // Update FAQ
  static async updateFaq(productId: number, faqId: number, input: UpdateFaqInput): Promise<AdminProductFaqJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const faq = await ProductFaq.findOne({ where: { id: faqId, product_id: productId } });
    if (!faq) {
      throw new ProductFaqNotFoundError(faqId);
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = {};
      if (input.question !== undefined) updates.question = input.question;
      if (input.answer !== undefined) updates.answer = input.answer;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;

      await faq.update(updates, { transaction: t });

      return formatAdminFaqDTO(faq);
    });
  }

  // Delete FAQ (hard delete — FAQs carry no downstream references, unlike Variants/Images)
  static async deleteFaq(productId: number, faqId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const faq = await ProductFaq.findOne({ where: { id: faqId, product_id: productId } });
    if (!faq) {
      throw new ProductFaqNotFoundError(faqId);
    }

    await faq.destroy();
  }

  // Reorder FAQs
  static async reorderFaqs(productId: number, orderedIds: number[]): Promise<AdminProductFaqJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const faqs = await ProductFaq.findAll({ where: { product_id: productId } });
    const requestedIds = new Set(uniqueIds);

    if (faqs.length !== uniqueIds.length || faqs.some((faq) => !requestedIds.has(faq.id))) {
      throw new InvalidProductDataError("FAQ reorder must include every record belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductFaq.update({ display_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductFaq.findAll({
        where: { product_id: productId },
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map(formatAdminFaqDTO);
    });
  }
}
