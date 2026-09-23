/* eslint-disable */
// Module 1 (database foundation only — see WELCOME_POPUP_REPOSITORY_AUDIT.md
// §H) model-level tests: no service/controller exists yet, so these exercise
// the WelcomePopup Sequelize model and its two database-level constraints
// directly — the "one homepage-active popup" generated-column unique index
// and the "active requires published" CHECK constraint.
import { afterAll, describe, expect, it } from "vitest";
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from "sequelize";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { WelcomePopup } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";

const createdIds: number[] = [];

async function createPopup(overrides: Partial<Parameters<typeof WelcomePopup.create>[0]> = {}) {
  return sequelize.transaction(async (transaction) => {
    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.welcomePopups, transaction);
    const popup = await WelcomePopup.create(
      {
        id,
        name: `WelcomePopup test ${id}`,
        template: "template_1",
        heading: "Unlock 10% off your first order",
        ...overrides
      } as any,
      { transaction }
    );
    createdIds.push(popup.id);
    return popup;
  });
}

describe("WelcomePopup model and database constraints", () => {
  afterAll(async () => {
    if (createdIds.length > 0) {
      await WelcomePopup.destroy({ where: { id: createdIds }, force: true });
    }
    await disconnectDatabase();
  });

  it("keeps legacy records on email signup with the default timing configuration", async () => {
    await connectDatabase();
    const popup = await createPopup();
    expect(popup.status).toBe("draft");
    expect(popup.is_homepage_active).toBe(false);
    expect(popup.cta_label).toBe("Subscribe");
    expect(popup.cta_mode).toBe("email_signup");
    expect(popup.display_delay_ms).toBe(1200);
    expect(popup.dismissal_cooldown_days).toBe(7);
    expect(popup.template).toBe("template_1");
  });

  it("supports multiple drafts and multiple published-but-inactive popups coexisting", async () => {
    const draftA = await createPopup({ status: "draft" } as any);
    const draftB = await createPopup({ status: "draft" } as any);
    const publishedInactiveA = await createPopup({ status: "published", template: "template_2" } as any);
    const publishedInactiveB = await createPopup({ status: "published", template: "template_2" } as any);

    const reloaded = await WelcomePopup.findAll({
      where: { id: [draftA.id, draftB.id, publishedInactiveA.id, publishedInactiveB.id] }
    });
    expect(reloaded).toHaveLength(4);
    expect(reloaded.every((row) => row.is_homepage_active === false)).toBe(true);
  });

  it("rejects is_homepage_active=true on a non-published popup (CHECK constraint)", async () => {
    const draft = await createPopup({ status: "draft" } as any);
    await expect(draft.update({ is_homepage_active: true })).rejects.toThrow();
  });

  it("allows exactly one homepage-active popup and rejects a second (generated-column unique index)", async () => {
    const first = await createPopup({ status: "published" } as any);
    await first.update({ is_homepage_active: true });

    const reloadedFirst = await WelcomePopup.findByPk(first.id);
    expect(reloadedFirst?.is_homepage_active).toBe(true);

    const second = await createPopup({ status: "published" } as any);
    await expect(second.update({ is_homepage_active: true })).rejects.toThrow(UniqueConstraintError);

    // The database rejected it — the first popup must still be the sole active one.
    const stillFirst = await WelcomePopup.findByPk(first.id);
    const stillSecond = await WelcomePopup.findByPk(second.id);
    expect(stillFirst?.is_homepage_active).toBe(true);
    expect(stillSecond?.is_homepage_active).toBe(false);

    // Deactivating the first frees the slot for the second.
    await first.update({ is_homepage_active: false });
    await second.update({ is_homepage_active: true });
    const nowSecond = await WelcomePopup.findByPk(second.id);
    expect(nowSecond?.is_homepage_active).toBe(true);
  });

  it("enforces the heading NOT NULL / non-empty validation", async () => {
    await expect(
      sequelize.transaction(async (transaction) => {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.welcomePopups, transaction);
        return WelcomePopup.create({ id, name: "no heading", template: "template_1", heading: "" } as any, { transaction });
      })
    ).rejects.toThrow(SequelizeValidationError);
  });
});
