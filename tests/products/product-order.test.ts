import { afterEach, describe, expect, it, vi } from "vitest";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductService } from "../../src/models/ProductModels/product.service.js";
import { storefrontProductListQuerySchema, updateProductSchema, moveWebsiteOrderSchema } from "../../src/models/ProductModels/product.validation.js";

vi.mock("../../src/database/index.js", () => ({ sequelize: { transaction: vi.fn(async (callback: (transaction: { LOCK: { UPDATE: string } }) => Promise<void>) => await callback({ LOCK: { UPDATE: "UPDATE" } })) } }));

vi.mock("../../src/models/ReviewModels/review.service.js", () => ({ computeReviewSummaries: vi.fn().mockResolvedValue(new Map()) }));

afterEach(() => vi.restoreAllMocks());

describe("Website product order", () => {
  it("orders in the database before limiting the page, and permits explicit newest sorting", async () => {
    const find = vi.spyOn(Product, "findAndCountAll").mockResolvedValue({ count: [], rows: [] });
    await ProductService.listStorefrontProducts({ page: 2, pageSize: 1, sort: "recommended" });
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({
      order: [["display_order", "ASC"], ["id", "DESC"]], limit: 1, offset: 1
    }));
    await ProductService.listStorefrontProducts({ sort: "newest" });
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ order: [["created_at", "DESC"], ["id", "DESC"]] }));
    await ProductService.listStorefrontProducts({ sort: "price_asc" });
    expect(find).toHaveBeenLastCalledWith(expect.objectContaining({ order: [["price", "ASC"], ["id", "ASC"]] }));
  });

  it("validates the saved order without resetting it on unrelated updates", () => {
    expect(updateProductSchema.safeParse({ displayOrder: 1 }).success).toBe(false);
    expect(moveWebsiteOrderSchema.parse({ direction: "up" })).toEqual({ direction: "up" });
    expect(moveWebsiteOrderSchema.safeParse({ direction: "sideways" }).success).toBe(false);
    expect(updateProductSchema.parse({ name: "Brush" })).not.toHaveProperty("displayOrder");
    for (const displayOrder of [-1, 1.5, 2147483648, "1"]) {
      expect(updateProductSchema.safeParse({ displayOrder }).success).toBe(false);
    }
    expect(storefrontProductListQuerySchema.parse({ sort: "recommended" }).sort).toBe("recommended");
  });

  it("normalizes duplicate priorities and saves a move in one locked transaction", async () => {
    const products = [
      { id: 1, display_order: 2, update: vi.fn() },
      { id: 2, display_order: 1, update: vi.fn() },
      { id: 3, display_order: 2, update: vi.fn() }
    ];
    const find = vi.spyOn(Product, "findAll").mockResolvedValue(products as unknown as Product[]);
    await ProductService.moveWebsiteOrder(1, "up");
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ lock: "UPDATE", transaction: { LOCK: { UPDATE: "UPDATE" } } }));
    expect(products.find((product) => product.id === 1)!.update).toHaveBeenCalledWith({ display_order: 2 }, { transaction: { LOCK: { UPDATE: "UPDATE" } } });
    expect(products.find((product) => product.id === 2)!.update).toHaveBeenCalledWith({ display_order: 1 }, { transaction: { LOCK: { UPDATE: "UPDATE" } } });
    expect(products.find((product) => product.id === 3)!.update).toHaveBeenCalledWith({ display_order: 3 }, { transaction: { LOCK: { UPDATE: "UPDATE" } } });
  });

  it("keeps boundary moves in place and rejects missing products", async () => {
    const product = { id: 1, display_order: 1000, update: vi.fn() };
    vi.spyOn(Product, "findAll").mockResolvedValue([product] as unknown as Product[]);
    await ProductService.moveWebsiteOrder(1, "up");
    expect(product.update).toHaveBeenCalledWith({ display_order: 1 }, { transaction: { LOCK: { UPDATE: "UPDATE" } } });
    await expect(ProductService.moveWebsiteOrder(99, "down")).rejects.toThrow("was not found");
  });
});
