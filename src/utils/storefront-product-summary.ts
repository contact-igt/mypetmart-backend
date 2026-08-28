import { ProductImage } from "../database/tables/ProductImageTable/index.js";
import { objectStorageService } from "../services/object-storage/object-storage.service.js";

export type StorefrontProductSummaryJSON = {
  id: number;
  name: string;
  slug: string;
  image: string | null;
};

/** Load one primary image per product in a single query for feed endpoints. */
export async function loadPrimaryProductImages(productIds: number[]): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) return new Map();

  const images = await ProductImage.findAll({
    where: { product_id: uniqueIds },
    attributes: ["product_id", "url", "r2_key", "is_primary", "sort_order"],
    order: [["is_primary", "DESC"], ["sort_order", "ASC"], ["id", "ASC"]]
  });

  const result = new Map<number, string>();
  for (const image of images) {
    if (!result.has(image.product_id)) {
      result.set(image.product_id, (image.r2_key ? objectStorageService.getPublicUrl(image.r2_key) : undefined) ?? image.url);
    }
  }
  return result;
}
