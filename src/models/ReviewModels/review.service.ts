import { Op, UniqueConstraintError, type Order as FindOrder, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductReview } from "../../database/tables/ProductReviewTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import { loadPrimaryProductImages } from "../../utils/storefront-product-summary.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { ProductNotFoundError } from "../ProductModels/product.errors.js";
import { DuplicateReviewError, ReviewNotEligibleError, ReviewNotFoundError } from "./review.errors.js";
import type {
  AdminCreateReviewInput,
  AdminReviewDetailJSON,
  AdminReviewListItemJSON,
  AdminReviewListQuery,
  AdminReviewListResult,
  AdminUpdateReviewInput,
  CreateReviewInput,
  OwnReviewJSON,
  PublicReviewJSON,
  PublicReviewListQuery,
  PublicReviewListResult,
  ReviewEligibilityJSON,
  ReviewRatingDistribution,
  ReviewSummaryJSON,
  StorefrontReviewFeedResult,
  UpdateReviewInput
} from "./review.types.js";

// A Product's own "was this genuinely delivered" signal — deliberately the
// exact same condition ReturnModels/return.service.ts uses to gate filing a
// Return (order.status is either "delivered", or "return_requested", which is
// the terminal value delivered flips to once a Return has been filed against
// it — see return.service.ts's resolveDeliveredAt/eligibility check and
// OrderModels/order.constants.ts's status graph). Reusing this exact
// condition — not inventing a second "delivered" definition — also directly
// satisfies the locked V1 rule that a later return/replacement/refund must
// never retroactively revoke Review eligibility (§46): "return_requested" is
// still an accepted delivered state here.
const DELIVERED_ORDER_STATUSES = ["delivered", "return_requested"] as const;

// Public chronology key for every storefront-facing review list: the
// admin-set review_date when present, otherwise the calendar date of
// created_at. A review an admin dated 14 Aug must not sort above a genuine
// review created 3 Sep just because created_at is newer (Customer Review
// Enhancement Stage 1). Columns are qualified to the `ProductReview` table
// alias Sequelize uses whenever the query has an include — both `products`
// and `users` are joined in the storefront feeds and also carry a
// `created_at` column (`review_date` is unambiguous: only product_reviews
// has it). This is a fixed internal expression — no request input is ever
// interpolated into it.
const EFFECTIVE_REVIEW_DATE_SQL = "COALESCE(`ProductReview`.`review_date`, DATE(`ProductReview`.`created_at`))";

// Full, unshortened name — used for Admin-facing views only, where seeing the
// real customer name (or the Admin-entered display name) is expected.
function resolveCustomerName(review: ProductReview): string {
  return review.user?.name?.trim() || review.customer_name?.trim() || "Customer";
}

// Public/Storefront display name — a genuine customer's full name is
// shortened to "First L." for privacy (unchanged, long-standing behavior).
// An Admin-authored Review has no real User to shorten — its customer_name is
// already the exact text an Admin chose to show, used as-is.
function formatCustomerDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Customer";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]!.charAt(0).toUpperCase()}.`;
}

function resolvePublicDisplayName(review: ProductReview): string {
  if (review.user) return formatCustomerDisplayName(review.user.name);
  return review.customer_name?.trim() || "Customer";
}

// Resolves the qualifying (delivered) OrderItem proving this User genuinely
// purchased this Product — Product-level, not Variant-level: any OrderItem
// row for this product_id qualifies regardless of which Variant was bought
// (see §5/§43). Never trusts a client-supplied orderId/orderItemId.
async function resolveQualifyingOrderItem(userId: number, productId: number): Promise<OrderItem | null> {
  return await OrderItem.findOne({
    where: { product_id: productId },
    include: [
      {
        model: Order,
        as: "order",
        where: { user_id: userId, status: { [Op.in]: DELIVERED_ORDER_STATUSES } },
        required: true,
        attributes: []
      }
    ],
    order: [["created_at", "DESC"]]
  });
}

function toPublicReviewJSON(review: ProductReview): PublicReviewJSON {
  const customerName = resolvePublicDisplayName(review);
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    review: review.review,
    customerName,
    // Kept for clients still reading the previous field during rollout.
    customerDisplayName: customerName,
    verifiedPurchase: review.review_source === "customer" && review.verified_purchase,
    reviewSource: review.review_source,
    // DATEONLY — already a plain "YYYY-MM-DD" string or null; never wrapped in
    // a Date / toISOString(). The storefront resolves `reviewDate ?? createdAt`.
    reviewDate: review.review_date ?? null,
    createdAt: review.created_at.toISOString()
  };
}

function toOwnReviewJSON(review: ProductReview): OwnReviewJSON {
  return {
    id: review.id,
    productId: review.product_id,
    rating: review.rating,
    title: review.title,
    review: review.review,
    status: review.status,
    verifiedPurchase: review.verified_purchase,
    createdAt: review.created_at.toISOString(),
    updatedAt: review.updated_at.toISOString()
  };
}

function toAdminListItemJSON(review: ProductReview): AdminReviewListItemJSON {
  return {
    id: review.id,
    productId: review.product_id,
    productName: review.product?.name ?? "",
    userId: review.user_id,
    customerName: resolveCustomerName(review),
    rating: review.rating,
    title: review.title,
    review: review.review,
    status: review.status,
    verifiedPurchase: review.verified_purchase,
    reviewSource: review.review_source,
    // Admin-set public review date ("YYYY-MM-DD" or null). createdAt / updatedAt
    // below stay the untouched system audit timestamps.
    reviewDate: review.review_date ?? null,
    createdAt: review.created_at.toISOString(),
    updatedAt: review.updated_at.toISOString()
  };
}

function toAdminDetailJSON(review: ProductReview): AdminReviewDetailJSON {
  return {
    ...toAdminListItemJSON(review),
    orderItemId: review.order_item_id,
    customerEmail: review.user?.email ?? null
  };
}

function emptyDistribution(): ReviewRatingDistribution {
  return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
}

// V1: computed live from product_reviews via SQL aggregation on every call —
// deliberately no denormalized products.average_rating/review_count column
// (see CLAUDE.md Written Product Reviews §23). Only APPROVED Reviews are ever
// summed here.
//
// Batched so a Product List/Detail page can score every product it returns
// with ONE grouped query (group by product_id + rating) instead of one query
// per product — see ProductModels/product.service.ts's storefront DTO
// builders, which are the only other callers. computeReviewSummary below is
// just this with a single-id input, so the single-product and list surfaces
// can never disagree.
export async function computeReviewSummaries(productIds: number[], transaction?: Transaction): Promise<Map<number, ReviewSummaryJSON>> {
  const result = new Map<number, ReviewSummaryJSON>();
  if (productIds.length === 0) return result;

  const rows = (await ProductReview.findAll({
    attributes: ["product_id", "rating", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
    where: { product_id: { [Op.in]: productIds }, status: "approved" },
    group: ["product_id", "rating"],
    raw: true,
    ...(transaction ? { transaction } : {})
  })) as unknown as Array<{ product_id: number; rating: number; count: string | number }>;

  const accumulators = new Map<number, { distribution: ReviewRatingDistribution; reviewCount: number; ratingSum: number }>();
  for (const row of rows) {
    const productId = Number(row.product_id);
    const rating = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
    const count = Number(row.count);
    if (rating < 1 || rating > 5) continue;

    let accumulator = accumulators.get(productId);
    if (!accumulator) {
      accumulator = { distribution: emptyDistribution(), reviewCount: 0, ratingSum: 0 };
      accumulators.set(productId, accumulator);
    }
    accumulator.distribution[rating] = count;
    accumulator.reviewCount += count;
    accumulator.ratingSum += rating * count;
  }

  for (const [productId, accumulator] of accumulators) {
    result.set(productId, {
      averageRating: accumulator.reviewCount > 0 ? Math.round((accumulator.ratingSum / accumulator.reviewCount) * 10) / 10 : 0,
      reviewCount: accumulator.reviewCount,
      distribution: accumulator.distribution
    });
  }

  return result;
}

async function computeReviewSummary(productId: number): Promise<ReviewSummaryJSON> {
  const summaries = await computeReviewSummaries([productId]);
  return summaries.get(productId) ?? { averageRating: 0, reviewCount: 0, distribution: emptyDistribution() };
}

export class ReviewService {
  // Eligibility check used by both the storefront eligibility endpoint and
  // createReview's own server-side gate — never trusts frontend claims.
  static async canUserReviewProduct(userId: number, productId: number): Promise<{ eligible: boolean; reason: string | null; orderItem: OrderItem | null }> {
    const orderItem = await resolveQualifyingOrderItem(userId, productId);
    if (!orderItem) {
      return { eligible: false, reason: "no delivered purchase of this product was found on your account.", orderItem: null };
    }
    return { eligible: true, reason: null, orderItem };
  }

  static async getReviewEligibility(userId: number, productId: number): Promise<ReviewEligibilityJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const existing = await ProductReview.findOne({ where: { user_id: userId, product_id: productId } });
    if (existing) {
      return { authenticated: true, eligible: true, hasReview: true, reviewStatus: existing.status, review: toOwnReviewJSON(existing) };
    }

    const { eligible } = await ReviewService.canUserReviewProduct(userId, productId);
    return { authenticated: true, eligible, hasReview: false };
  }

  static async createReview(userId: number, productId: number, input: CreateReviewInput): Promise<OwnReviewJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const existing = await ProductReview.findOne({ where: { user_id: userId, product_id: productId } });
    if (existing) {
      throw new DuplicateReviewError();
    }

    const { eligible, reason, orderItem } = await ReviewService.canUserReviewProduct(userId, productId);
    if (!eligible || !orderItem) {
      throw new ReviewNotEligibleError(reason ?? "you have not purchased this product.");
    }

    return await sequelize.transaction(async (t) => {
      const reviewId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productReviews, t);

      try {
        const review = await ProductReview.create(
          {
            id: reviewId,
            product_id: productId,
            user_id: userId,
            order_item_id: orderItem.id,
            rating: input.rating,
            title: input.title?.trim() || null,
            review: input.review,
            status: "pending",
            verified_purchase: true
          },
          { transaction: t }
        );

        return toOwnReviewJSON(review);
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw new DuplicateReviewError();
        }
        throw error;
      }
    });
  }

  // Editing content on an already-moderated Review resets it to "pending" —
  // Admin-approved/rejected content has materially changed and must be
  // re-reviewed (§16). verifiedPurchase and the qualifying OrderItem are
  // never touched by an edit — they remain whatever was proven at creation.
  static async updateOwnReview(userId: number, productId: number, input: UpdateReviewInput): Promise<OwnReviewJSON> {
    const review = await ProductReview.findOne({ where: { user_id: userId, product_id: productId } });
    if (!review) {
      throw new ReviewNotFoundError(`for product ${productId}`);
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = { status: "pending" };
      if (input.rating !== undefined) updates.rating = input.rating;
      if (input.title !== undefined) updates.title = input.title?.trim() || null;
      if (input.review !== undefined) updates.review = input.review;

      await review.update(updates, { transaction: t });
      return toOwnReviewJSON(review);
    });
  }

  static async listPublicReviews(productId: number, query: PublicReviewListQuery): Promise<PublicReviewListResult> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize || 10));
    const offset = (page - 1) * pageSize;

    // newest = effective public review date (review_date ?? DATE(created_at)),
    // then created_at, then id — a deterministic tiebreak so two reviews with
    // the same effective date always order the same way. highest/lowest keep
    // rating as the primary key, unchanged.
    const effectiveDate = sequelize.literal(EFFECTIVE_REVIEW_DATE_SQL);
    let order: FindOrder = [[effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];
    if (query.sort === "highest") order = [["rating", "DESC"], [effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];
    if (query.sort === "lowest") order = [["rating", "ASC"], [effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];

    const [{ count, rows }, summary] = await Promise.all([
      ProductReview.findAndCountAll({
        where: { product_id: productId, status: "approved" },
        include: [{ model: User, as: "user", attributes: ["name"] }],
        order,
        limit: pageSize,
        offset
      }),
      computeReviewSummary(productId)
    ]);

    return {
      items: rows.map(toPublicReviewJSON),
      page,
      pageSize,
      total: count,
      summary
    };
  }

  static async getReviewSummary(productId: number): Promise<ReviewSummaryJSON> {
    return await computeReviewSummary(productId);
  }

  static async listPublicReviewsGlobal(query: PublicReviewListQuery): Promise<StorefrontReviewFeedResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize || 10));
    const offset = (page - 1) * pageSize;

    // Same public effective-date chronology as the PDP list above — the
    // homepage feed and a product's own PDP list must never disagree on order.
    const effectiveDate = sequelize.literal(EFFECTIVE_REVIEW_DATE_SQL);
    let order: FindOrder = [[effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];
    if (query.sort === "highest") order = [["rating", "DESC"], [effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];
    if (query.sort === "lowest") order = [["rating", "ASC"], [effectiveDate, "DESC"], ["created_at", "DESC"], ["id", "DESC"]];

    const { count, rows } = await ProductReview.findAndCountAll({
      where: { status: "approved" },
      include: [
        { model: Product, as: "product", required: true, where: { status: "active" }, attributes: ["id", "name", "slug"] },
        { model: User, as: "user", required: false, attributes: ["name"] }
      ],
      order,
      limit: pageSize,
      offset,
      distinct: true
    });

    const imageByProduct = await loadPrimaryProductImages(rows.map((review) => review.product_id));
    const reviews = rows.flatMap((review) => {
      const product = review.product;
      if (!product) return [];
      const publicReview = toPublicReviewJSON(review);
      return [{
        id: publicReview.id,
        rating: publicReview.rating,
        title: publicReview.title,
        review: publicReview.review,
        customerName: publicReview.customerName,
        verifiedPurchase: publicReview.verifiedPurchase,
        reviewDate: publicReview.reviewDate,
        createdAt: publicReview.createdAt,
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          image: imageByProduct.get(product.id) ?? null
        }
      }];
    });

    return { reviews, page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) };
  }

  static async listAdminReviews(query: AdminReviewListQuery): Promise<AdminReviewListResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;
    if (query.productId) where.product_id = query.productId;
    if (query.source) where.review_source = query.source;

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      where[Op.or as unknown as string] = [{ title: { [Op.like]: term } }, { review: { [Op.like]: term } }];
    }

    const { count, rows } = await ProductReview.findAndCountAll({
      where,
      include: [
        { model: Product, as: "product", attributes: ["id", "name"], paranoid: false },
        { model: User, as: "user", attributes: ["id", "name"], required: false, paranoid: false }
      ],
      order: [["created_at", "DESC"]],
      limit: pageSize,
      offset,
      distinct: true
    });

    return {
      items: rows.map(toAdminListItemJSON),
      page,
      pageSize,
      total: count
    };
  }

  static async getAdminReview(reviewId: number, transaction?: Transaction): Promise<AdminReviewDetailJSON> {
    const review = await ProductReview.findByPk(reviewId, {
      include: [
        { model: Product, as: "product", attributes: ["id", "name"], paranoid: false },
        { model: User, as: "user", attributes: ["id", "name", "email"], required: false, paranoid: false }
      ],
      ...(transaction ? { transaction } : {})
    });
    if (!review) {
      throw new ReviewNotFoundError(reviewId);
    }
    return toAdminDetailJSON(review);
  }

  // Admin edit — allows rating/title/review/status (unlike a customer's own
  // edit, this never resets status to "pending": the Admin is choosing the
  // status directly, not just changing content).
  static async updateReviewStatus(reviewId: number, input: AdminUpdateReviewInput): Promise<AdminReviewDetailJSON> {
    const review = await ProductReview.findByPk(reviewId, {
      include: [
        { model: Product, as: "product", attributes: ["id", "name"], paranoid: false },
        { model: User, as: "user", attributes: ["id", "name", "email"], required: false, paranoid: false }
      ]
    });
    if (!review) {
      throw new ReviewNotFoundError(reviewId);
    }

    const updates: Record<string, unknown> = {};
    if (input.rating !== undefined) updates.rating = input.rating;
    if (input.title !== undefined) updates.title = input.title?.trim() || null;
    if (input.review !== undefined) updates.review = input.review;
    if (input.status !== undefined) updates.status = input.status;
    // Tri-state: field absent (undefined) leaves the stored review_date
    // untouched; explicit null clears it; a "YYYY-MM-DD" string sets it.
    // Changing only the review date never touches moderation status,
    // verified_purchase, review_source or ownership.
    if (input.reviewDate !== undefined) updates.review_date = input.reviewDate;

    await review.update(updates);
    return toAdminDetailJSON(review);
  }

  // Manually-authored Admin Review — never backed by a real User/OrderItem.
  // Always forces reviewSource="admin", verifiedPurchase=false, userId=null,
  // orderItemId=null server-side, regardless of what the request body sends
  // (the validated AdminCreateReviewInput type has no such fields at all).
  static async createAdminReview(input: AdminCreateReviewInput): Promise<AdminReviewDetailJSON> {
    const product = await Product.findByPk(input.productId);
    if (!product) {
      throw new ProductNotFoundError(input.productId);
    }

    return await sequelize.transaction(async (t) => {
      const reviewId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productReviews, t);

      await ProductReview.create(
        {
          id: reviewId,
          product_id: input.productId,
          user_id: null,
          order_item_id: null,
          rating: input.rating,
          title: input.title?.trim() || null,
          review: input.review,
          status: input.status ?? "pending",
          verified_purchase: false,
          customer_name: input.customerName?.trim() || "Admin",
          review_source: "admin",
          // Omitted / undefined stores NULL — never auto-filled with today.
          review_date: input.reviewDate ?? null
        },
        { transaction: t }
      );

      return await ReviewService.getAdminReview(reviewId, t);
    });
  }

  // Hard delete — mirrors ProductFeatureService.deleteFeature's pattern
  // (no soft-delete/paranoid mode exists on product_reviews).
  static async deleteAdminReview(reviewId: number): Promise<void> {
    const review = await ProductReview.findByPk(reviewId);
    if (!review) {
      throw new ReviewNotFoundError(reviewId);
    }
    await review.destroy();
  }
}
