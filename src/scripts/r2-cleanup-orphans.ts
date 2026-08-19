import { connectDatabase, disconnectDatabase } from "../database/index.js";
import { ProductImage } from "../database/tables/ProductImageTable/index.js";
import { objectStorageService } from "../services/object-storage/object-storage.service.js";
import { logger } from "../utils/logger.js";

async function main(): Promise<void> {
  objectStorageService.ensureConfigured();
  await connectDatabase();
  try {
    const imageRows = await ProductImage.findAll({ attributes: ["r2_key"] });
    const referencedKeys = new Set(imageRows.map((image) => image.r2_key).filter((key): key is string => key !== null));
    const result = await objectStorageService.cleanupUnattachedProductUploads(referencedKeys);
    logger.info(result, "Cloudflare R2 unattached Product upload cleanup completed");
  } finally {
    await disconnectDatabase();
  }
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, "Cloudflare R2 unattached Product upload cleanup failed");
  process.exitCode = 1;
});
