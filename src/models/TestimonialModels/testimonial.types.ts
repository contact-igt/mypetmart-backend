import type { StorefrontProductSummaryJSON } from "../../utils/storefront-product-summary.js";

export type StorefrontTestimonialJSON = {
  id: number;
  videoUrl: string;
  title: string | null;
  caption: string | null;
  product: StorefrontProductSummaryJSON;
};

export type StorefrontTestimonialListResult = {
  testimonials: StorefrontTestimonialJSON[];
};
