import { ProductMediaAssignment } from "../../database/tables/ProductMediaAssignmentTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { objectStorageService } from "../../services/object-storage/object-storage.service.js";
import { loadPrimaryProductImages, type StorefrontProductSummaryJSON } from "../../utils/storefront-product-summary.js";
import { ProductNotFoundError } from "../ProductModels/product.errors.js";
import type { StorefrontTestimonialJSON, StorefrontTestimonialListResult } from "./testimonial.types.js";

type TestimonialQueryOptions = { productId?: number };

export class StorefrontTestimonialService {
  static async list(options: TestimonialQueryOptions = {}): Promise<StorefrontTestimonialListResult> {
    if (options.productId !== undefined) {
      const product = await Product.findOne({ where: { id: options.productId, status: "active" }, attributes: ["id"] });
      if (!product) throw new ProductNotFoundError(options.productId);
    }

    const assignments = await ProductMediaAssignment.findAll({
      where: {
        media_role: "testimonial_video",
        active: true,
        ...(options.productId !== undefined ? { product_id: options.productId } : {})
      },
      include: [
        {
          association: "product",
          required: true,
          where: { status: "active" },
          attributes: ["id", "name", "slug"]
        },
        {
          association: "mediaAsset",
          required: true,
          where: { media_type: "video" },
          attributes: ["public_url", "storage_key", "media_type", "mime_type"]
        }
      ],
      order: [["display_order", "ASC"], ["created_at", "DESC"], ["id", "ASC"]]
    });

    const imageByProduct = await loadPrimaryProductImages(assignments.map((assignment) => assignment.product_id));
    const testimonials = assignments.flatMap((assignment) => {
      const product = assignment.product;
      const asset = assignment.mediaAsset;
      if (!product || !asset) return [];

      const productSummary: StorefrontProductSummaryJSON = {
        id: product.id,
        name: product.name,
        slug: product.slug,
        image: imageByProduct.get(product.id) ?? null
      };

      const item: StorefrontTestimonialJSON = {
        id: assignment.id,
        videoUrl: (asset.storage_key ? objectStorageService.getPublicUrl(asset.storage_key) : undefined) ?? asset.public_url,
        title: assignment.title,
        caption: assignment.caption,
        product: productSummary
      };
      return [item];
    });

    return { testimonials };
  }
}
