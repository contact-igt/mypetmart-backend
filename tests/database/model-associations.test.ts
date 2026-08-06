import { describe, expect, it } from "vitest";

import { databaseModels } from "../../src/database/index.js";

function association(modelName: keyof typeof databaseModels, alias: string) {
  const assoc = databaseModels[modelName].associations[alias];
  if (assoc === undefined) {
    throw new Error(`${String(modelName)}.${alias} association is missing.`);
  }

  return assoc;
}

describe("database model associations", () => {
  it("defines user-owned and authored relationships", () => {
    expect(association("User", "authSessions").associationType).toBe("HasMany");
    expect(association("AuthSession", "user").associationType).toBe("BelongsTo");
    expect(association("User", "addresses").associationType).toBe("HasMany");
    expect(association("Address", "user").associationType).toBe("BelongsTo");
    expect(association("User", "carts").associationType).toBe("HasMany");
    expect(association("User", "orders").associationType).toBe("HasMany");
    expect(association("User", "returnRequests").associationType).toBe("HasMany");
    expect(association("User", "authoredOrderNotes").foreignKey).toBe("admin_id");
    expect(association("OrderNote", "author").foreignKey).toBe("admin_id");
    expect(association("User", "authoredReturnNotes").foreignKey).toBe("admin_id");
    expect(association("ReturnNote", "author").foreignKey).toBe("admin_id");
  });

  it("defines catalog relationships", () => {
    expect(association("Category", "products").associationType).toBe("HasMany");
    expect(association("Product", "category").associationType).toBe("BelongsTo");
    expect(association("Product", "variants").associationType).toBe("HasMany");
    expect(association("ProductVariant", "product").associationType).toBe("BelongsTo");
    expect(association("Product", "images").associationType).toBe("HasMany");
    expect(association("ProductImage", "product").associationType).toBe("BelongsTo");
  });

  it("defines cart line relationships", () => {
    expect(association("Cart", "items").associationType).toBe("HasMany");
    expect(association("CartItem", "cart").associationType).toBe("BelongsTo");
    expect(association("Product", "cartItems").associationType).toBe("HasMany");
    expect(association("CartItem", "product").associationType).toBe("BelongsTo");
    expect(association("ProductVariant", "cartItems").associationType).toBe("HasMany");
    expect(association("CartItem", "variant").associationType).toBe("BelongsTo");
  });

  it("defines order, payment, shipment and return relationships", () => {
    expect(association("Order", "items").associationType).toBe("HasMany");
    expect(association("OrderItem", "order").associationType).toBe("BelongsTo");
    expect(association("Order", "notes").associationType).toBe("HasMany");
    expect(association("OrderNote", "order").associationType).toBe("BelongsTo");
    expect(association("Order", "payments").associationType).toBe("HasMany");
    expect(association("Payment", "order").associationType).toBe("BelongsTo");
    expect(association("Order", "shipments").associationType).toBe("HasMany");
    expect(association("Shipment", "order").associationType).toBe("BelongsTo");
    expect(association("Order", "returns").associationType).toBe("HasMany");
    expect(association("OrderItem", "returnRequests").associationType).toBe("HasMany");
    expect(association("ReturnRequest", "order").associationType).toBe("BelongsTo");
    expect(association("ReturnRequest", "orderItem").associationType).toBe("BelongsTo");
    expect(association("ReturnRequest", "notes").associationType).toBe("HasMany");
    expect(association("ReturnNote", "returnRequest").associationType).toBe("BelongsTo");
  });
});