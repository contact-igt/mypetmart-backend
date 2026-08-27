import type { ReviewSource, ReviewStatus } from "../../constants/database.constants.js";

// Public/Storefront shape — deliberately omits userId, orderItemId, and any
// moderation data. See review.service.ts's `toPublicReviewJSON`.
export type PublicReviewJSON = {
  id: number;
  rating: number;
  title: string | null;
  review: string;
  customerName: string;
  customerDisplayName: string;
  verifiedPurchase: boolean;
  reviewSource: ReviewSource;
  createdAt: string;
};

export type AdminReviewListItemJSON = {
  id: number;
  productId: number;
  productName: string;
  userId: number | null;
  customerName: string;
  rating: number;
  title: string | null;
  review: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  reviewSource: ReviewSource;
  createdAt: string;
  updatedAt: string;
};

export type AdminReviewDetailJSON = AdminReviewListItemJSON & {
  orderItemId: number | null;
  customerEmail: string | null;
};

export type ReviewRatingDistribution = {
  5: number;
  4: number;
  3: number;
  2: number;
  1: number;
};

export type ReviewSummaryJSON = {
  averageRating: number;
  reviewCount: number;
  distribution: ReviewRatingDistribution;
};

export type PublicReviewListResult = {
  items: PublicReviewJSON[];
  page: number;
  pageSize: number;
  total: number;
  summary: ReviewSummaryJSON;
};

// The customer's own Review, as returned by create/update/eligibility — shows
// moderation status (unlike PublicReviewJSON) since the customer needs to see
// "Pending approval" / "Published" / "Not approved" for their own submission,
// but still never exposes userId/orderItemId (server-trusted, not the
// customer's concern).
export type OwnReviewJSON = {
  id: number;
  productId: number;
  rating: number;
  title: string | null;
  review: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReviewEligibilityJSON = {
  authenticated: boolean;
  eligible: boolean;
  hasReview: boolean;
  reviewStatus?: ReviewStatus;
  // Present only when hasReview is true — lets the PDP prefill an "Edit Your
  // Review" form without a second round trip. Still the safe own-review shape.
  review?: OwnReviewJSON;
};

export type CreateReviewInput = {
  rating: number;
  title?: string | null;
  review: string;
};

export type UpdateReviewInput = Partial<CreateReviewInput>;

export type AdminUpdateReviewInput = {
  rating?: number;
  title?: string | null;
  review?: string;
  status?: ReviewStatus;
};

// Manual Admin-authored Review — never backed by a real User/OrderItem.
// Server always forces reviewSource="admin", verifiedPurchase=false,
// userId=null, orderItemId=null regardless of what's requested here.
export type AdminCreateReviewInput = {
  productId: number;
  customerName?: string | null;
  rating: number;
  title?: string | null;
  review: string;
  status?: ReviewStatus;
};

export type PublicReviewListQuery = {
  page?: number;
  pageSize?: number;
  sort?: "newest" | "highest" | "lowest";
};

export type AdminReviewListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ReviewStatus;
  rating?: number;
  productId?: number;
  source?: ReviewSource;
};

export type AdminReviewListResult = {
  items: AdminReviewListItemJSON[];
  page: number;
  pageSize: number;
  total: number;
};
