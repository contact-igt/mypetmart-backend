import { Op, UniqueConstraintError, type Transaction } from "sequelize";
import { DATABASE_TABLE_NAMES, type CouponStatus } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { Category, Coupon, CouponCategory, CouponProduct, CouponRedemption, Order, Product } from "../../database/tables/index.js";
import { CouponError } from "./coupon.errors.js";
import { normalizeCouponCode } from "./coupon.validation.js";
import type { AdminCouponInput, AdminCouponListQuery, AdminCouponRedemptionListQuery } from "./admin-coupon.validation.js";

const ACTIVE_REDEMPTION_STATUSES = ["reserved", "consumed"] as const;
const SORT_COLUMNS = { code: "code", name: "name", status: "status", discountType: "discount_type", startsAt: "starts_at", endsAt: "ends_at", createdAt: "created_at", updatedAt: "updated_at" } as const;

async function assertRestrictions(productIds: number[], categoryIds: number[], transaction?: Transaction): Promise<void> {
  const transactionOptions = transaction ? { transaction } : {};
  const [products, categories] = await Promise.all([
    Product.count({ where: { id: { [Op.in]: productIds } }, ...transactionOptions }),
    Category.count({ where: { id: { [Op.in]: categoryIds } }, ...transactionOptions })
  ]);
  if (products !== productIds.length) throw new CouponError("COUPON_INVALID_PRODUCTS", "One or more selected products do not exist.", 422);
  if (categories !== categoryIds.length) throw new CouponError("COUPON_INVALID_CATEGORIES", "One or more selected categories do not exist.", 422);
}

async function replaceRestrictions(couponId: number, productIds: number[], categoryIds: number[], transaction: Transaction): Promise<void> {
  await Promise.all([
    CouponProduct.destroy({ where: { coupon_id: couponId }, transaction }),
    CouponCategory.destroy({ where: { coupon_id: couponId }, transaction })
  ]);
  for (const productId of productIds) {
    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponProducts, transaction);
    await CouponProduct.create({ id, coupon_id: couponId, product_id: productId }, { transaction });
  }
  for (const categoryId of categoryIds) {
    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponCategories, transaction);
    await CouponCategory.create({ id, coupon_id: couponId, category_id: categoryId }, { transaction });
  }
}

function sameIds(left: number[], right: number[]): boolean {
  return [...left].sort((a, b) => a - b).join(",") === [...right].sort((a, b) => a - b).join(",");
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

async function serializeCoupon(coupon: Coupon) {
  const [productLinks, categoryLinks, activeCount, historyCount] = await Promise.all([
    CouponProduct.findAll({ where: { coupon_id: coupon.id }, order: [["product_id", "ASC"]] }),
    CouponCategory.findAll({ where: { coupon_id: coupon.id }, order: [["category_id", "ASC"]] }),
    CouponRedemption.count({ where: { coupon_id: coupon.id, status: { [Op.in]: ACTIVE_REDEMPTION_STATUSES } } }),
    CouponRedemption.count({ where: { coupon_id: coupon.id } })
  ]);
  const productIds = productLinks.map((link) => link.product_id);
  const categoryIds = categoryLinks.map((link) => link.category_id);
  const [products, categories] = await Promise.all([
    Product.findAll({ where: { id: { [Op.in]: productIds } }, attributes: ["id", "name", "sku"] }),
    Category.findAll({ where: { id: { [Op.in]: categoryIds } }, attributes: ["id", "name"] })
  ]);
  return {
    id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discount_type, discountValue: coupon.discount_value,
    maxDiscountPaise: coupon.max_discount_paise, minEligibleAmountPaise: coupon.min_eligible_amount_paise,
    startsAt: coupon.starts_at?.toISOString() ?? null, endsAt: coupon.ends_at?.toISOString() ?? null,
    usageLimit: coupon.usage_limit, perCustomerLimit: coupon.per_customer_limit, firstOrderOnly: coupon.first_order_only,
    status: coupon.status, usedCount: activeCount, remainingUses: coupon.usage_limit === null ? null : Math.max(0, coupon.usage_limit - activeCount),
    eligibleProductIds: productIds, eligibleCategoryIds: categoryIds,
    eligibleProducts: products.map(({ id, name, sku }) => ({ id, name, sku })),
    eligibleCategories: categories.map(({ id, name }) => ({ id, name })),
    hasReservations: historyCount > 0,
    createdAt: coupon.created_at.toISOString(), updatedAt: coupon.updated_at.toISOString()
  };
}

async function findCoupon(id: number, transaction?: Transaction, lock = false): Promise<Coupon> {
  const coupon = await Coupon.findByPk(id, transaction ? { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) } : {});
  if (!coupon) throw new CouponError("COUPON_NOT_FOUND", "Coupon was not found.", 404);
  return coupon;
}

export class AdminCouponService {
  public static async list(query: AdminCouponListQuery) {
    const where = {
      ...(query.search ? { [Op.or]: [{ code: { [Op.like]: `%${query.search}%` } }, { name: { [Op.like]: `%${query.search}%` } }] } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.discountType ? { discount_type: query.discountType } : {})
    };
    const { rows, count } = await Coupon.findAndCountAll({ where, order: [[SORT_COLUMNS[query.sortBy], query.sortDir], ["id", "DESC"]], limit: query.pageSize, offset: (query.page - 1) * query.pageSize });
    return { items: await Promise.all(rows.map(serializeCoupon)), total: count, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(count / query.pageSize) };
  }

  public static async get(id: number) { return serializeCoupon(await findCoupon(id)); }

  public static async create(input: AdminCouponInput) {
    try {
      const id = await sequelize.transaction(async (transaction) => {
        await assertRestrictions(input.eligibleProductIds, input.eligibleCategoryIds, transaction);
        const couponId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.coupons, transaction);
        await Coupon.create({ id: couponId, code: normalizeCouponCode(input.code), name: input.name, discount_type: input.discountType, discount_value: input.discountValue, max_discount_paise: input.maxDiscountPaise, min_eligible_amount_paise: input.minEligibleAmountPaise, starts_at: input.startsAt, ends_at: input.endsAt, usage_limit: input.usageLimit, per_customer_limit: input.perCustomerLimit, first_order_only: input.firstOrderOnly, status: "draft" }, { transaction });
        await replaceRestrictions(couponId, input.eligibleProductIds, input.eligibleCategoryIds, transaction);
        return couponId;
      });
      return this.get(id);
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new CouponError("COUPON_CODE_CONFLICT", "A coupon with this code already exists.", 409);
      throw error;
    }
  }

  public static async update(id: number, input: AdminCouponInput) {
    try {
      await sequelize.transaction(async (transaction) => {
        const coupon = await findCoupon(id, transaction, true);
        const [productLinks, categoryLinks, historyCount] = await Promise.all([
          CouponProduct.findAll({ where: { coupon_id: id }, transaction }), CouponCategory.findAll({ where: { coupon_id: id }, transaction }), CouponRedemption.count({ where: { coupon_id: id }, transaction })
        ]);
        if (historyCount > 0) {
          const changed = normalizeCouponCode(input.code) !== coupon.code || input.discountType !== coupon.discount_type || input.discountValue !== coupon.discount_value || input.maxDiscountPaise !== coupon.max_discount_paise || input.minEligibleAmountPaise !== coupon.min_eligible_amount_paise || !sameDate(input.startsAt, coupon.starts_at) || !sameDate(input.endsAt, coupon.ends_at) || input.usageLimit !== coupon.usage_limit || input.perCustomerLimit !== coupon.per_customer_limit || input.firstOrderOnly !== coupon.first_order_only || !sameIds(input.eligibleProductIds, productLinks.map((x) => x.product_id)) || !sameIds(input.eligibleCategoryIds, categoryLinks.map((x) => x.category_id));
          if (changed) throw new CouponError("COUPON_TERMS_IMMUTABLE", "Coupon terms cannot be changed after the coupon has redemption history.", 409);
        }
        if (historyCount === 0) await assertRestrictions(input.eligibleProductIds, input.eligibleCategoryIds, transaction);
        await coupon.update({ code: normalizeCouponCode(input.code), name: input.name, discount_type: input.discountType, discount_value: input.discountValue, max_discount_paise: input.maxDiscountPaise, min_eligible_amount_paise: input.minEligibleAmountPaise, starts_at: input.startsAt, ends_at: input.endsAt, usage_limit: input.usageLimit, per_customer_limit: input.perCustomerLimit, first_order_only: input.firstOrderOnly }, { transaction });
        if (historyCount === 0) await replaceRestrictions(id, input.eligibleProductIds, input.eligibleCategoryIds, transaction);
      });
      return this.get(id);
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw new CouponError("COUPON_CODE_CONFLICT", "A coupon with this code already exists.", 409);
      throw error;
    }
  }

  public static async setStatus(id: number, status: CouponStatus) {
    const coupon = await findCoupon(id);
    await coupon.update({ status });
    return this.get(id);
  }

  public static async listRedemptions(id: number, query: AdminCouponRedemptionListQuery) {
    await findCoupon(id);
    const where: Record<string, unknown> = { coupon_id: id };
    if (query.status) where.status = query.status;
    const { rows, count } = await CouponRedemption.findAndCountAll({ where, order: [["reserved_at", "DESC"], ["id", "DESC"]], limit: query.pageSize, offset: (query.page - 1) * query.pageSize });
    const orders = await Order.findAll({ where: { id: { [Op.in]: rows.map((row) => row.order_id) } }, attributes: ["id", "order_number"] });
    const orderNumbers = new Map(orders.map((order) => [order.id, order.order_number]));
    return { items: rows.map((row) => ({ id: row.id, orderId: row.order_id, orderNumber: orderNumbers.get(row.order_id) ?? String(row.order_id), status: row.status, couponCodeSnapshot: row.code_snapshot, discountAmountPaise: row.discount_amount_paise, eligibleMerchandisePaise: row.eligible_merchandise_paise, customerType: row.user_id === null ? "guest" as const : "customer" as const, reservedAt: row.reserved_at.toISOString(), consumedAt: row.consumed_at?.toISOString() ?? null, releasedAt: row.released_at?.toISOString() ?? null })), total: count, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(count / query.pageSize) };
  }
}
