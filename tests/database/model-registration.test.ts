import { describe, expect, it, vi } from "vitest";

import { sequelize, databaseModels } from "../../src/database/index.js";
import { areDatabaseAssociationsInitialized, initializeDatabaseAssociations } from "../../src/database/associations.js";
import { EXPECTED_DATABASE_MODEL_NAMES, getModelList, initializeDatabaseModels } from "../../src/database/tables/index.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";

const expectedTables = [
  DATABASE_TABLE_NAMES.users,
  DATABASE_TABLE_NAMES.authSessions,
  DATABASE_TABLE_NAMES.addresses,
  DATABASE_TABLE_NAMES.categories,
  DATABASE_TABLE_NAMES.products,
  DATABASE_TABLE_NAMES.productVariants,
  DATABASE_TABLE_NAMES.productImages,
  DATABASE_TABLE_NAMES.productFeatures,
  DATABASE_TABLE_NAMES.productMediaAssignments,
  DATABASE_TABLE_NAMES.mediaAssets,
  DATABASE_TABLE_NAMES.carts,
  DATABASE_TABLE_NAMES.cartItems,
  DATABASE_TABLE_NAMES.orders,
  DATABASE_TABLE_NAMES.orderItems,
  DATABASE_TABLE_NAMES.orderNotes,
  DATABASE_TABLE_NAMES.payments,
  DATABASE_TABLE_NAMES.shipments,
  DATABASE_TABLE_NAMES.shipmentTrackingEvents,
  DATABASE_TABLE_NAMES.returnRequests,
  DATABASE_TABLE_NAMES.returnNotes,
  DATABASE_TABLE_NAMES.refunds,
  DATABASE_TABLE_NAMES.replacements,
  DATABASE_TABLE_NAMES.contactEnquiries,
  DATABASE_TABLE_NAMES.storeSettings,
  DATABASE_TABLE_NAMES.authChallenges,
  DATABASE_TABLE_NAMES.passwordResetTokens,
  DATABASE_TABLE_NAMES.wishlists,
  DATABASE_TABLE_NAMES.newsletterSubscribers,
  DATABASE_TABLE_NAMES.notificationLog
];

describe("database model registration", () => {
  it("registers all expected models with explicit table names", () => {
    expect(Object.keys(databaseModels)).toEqual([...EXPECTED_DATABASE_MODEL_NAMES]);
    expect(sequelize.modelManager.models).toHaveLength(29);

    const modelNames = getModelList(databaseModels).map((model) => model.name);
    const tableNames = getModelList(databaseModels).map((model) => model.tableName);

    expect(modelNames).toEqual([...EXPECTED_DATABASE_MODEL_NAMES]);
    expect(tableNames).toEqual(expectedTables);
  });

  it("initializes models and associations idempotently", () => {
    const firstRegistry = initializeDatabaseModels(sequelize);
    const secondRegistry = initializeDatabaseModels(sequelize);

    expect(secondRegistry).toBe(firstRegistry);
    expect(secondRegistry).toBe(databaseModels);
    expect(getModelList(secondRegistry).every((model) => model.sequelize === sequelize)).toBe(true);

    initializeDatabaseAssociations(secondRegistry);
    initializeDatabaseAssociations(secondRegistry);
    expect(areDatabaseAssociationsInitialized()).toBe(true);
    expect(Object.keys(databaseModels.User.associations)).toContain("authSessions");
  });

  it("does not call sync during metadata initialization", () => {
    const syncSpy = vi.spyOn(sequelize, "sync");

    initializeDatabaseModels(sequelize);
    initializeDatabaseAssociations(databaseModels);

    expect(syncSpy).not.toHaveBeenCalled();
    syncSpy.mockRestore();
  });
});
