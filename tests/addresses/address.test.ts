/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const ADDRESS_URL = "/api/v1/storefront/addresses";

function validAddressPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    label: "Home",
    recipientName: "Jordan Rivera",
    phone: "+91 98765 43210",
    line1: "221B Baker Street",
    line2: "Near Central Park",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    ...overrides
  };
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Address Test Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({
    sub: String(user.id),
    sessionId: String(session.id),
    role: "customer",
    sessionType: "customer"
  });
}

describe("Address Book Backend Integration Tests", () => {
  let customerAToken: string;
  let customerBToken: string;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [99401, 99402]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(99401, "address-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(99402, "address-test-customer-b@example.com");
  });

  afterAll(async () => {
    await Address.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [99401, 99402] }, force: true });
    await User.destroy({ where: { id: [99401, 99402] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Address.destroy({ where: {}, truncate: false, force: true });
  });

  it("rejects unauthenticated address list requests", async () => {
    const res = await request(app).get(ADDRESS_URL);
    expect(res.status).toBe(401);
  });

  it("makes the first created address default", async () => {
    const res = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    expect(res.status).toBe(201);
    expect(res.body.data.isDefault).toBe(true);
  });

  it("keeps the first address default when a second is added without isDefault", async () => {
    const first = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Office" }));

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    const defaultAddress = list.body.data.find((a: { isDefault: boolean }) => a.isDefault);
    expect(defaultAddress.id).toBe(first.body.data.id);
  });

  it("switches the default when a second address is created with isDefault:true", async () => {
    const first = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    const second = await request(app)
      .post(ADDRESS_URL)
      .set("Authorization", `Bearer ${customerAToken}`)
      .send(validAddressPayload({ label: "Office", isDefault: true }));

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    const defaults = list.body.data.filter((a: { isDefault: boolean }) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.body.data.id);
    expect(list.body.data.find((a: { id: number }) => a.id === first.body.data.id).isDefault).toBe(false);
  });

  it("lists only the caller's own addresses", async () => {
    await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerBToken}`).send(validAddressPayload());

    const aList = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    expect(aList.body.data).toHaveLength(1);
    const bList = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerBToken}`);
    expect(bList.body.data).toHaveLength(1);
  });

  it("gets one owned address", async () => {
    const created = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const res = await request(app).get(`${ADDRESS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it("returns 404, not another customer's data, when getting a non-owned address", async () => {
    const created = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const res = await request(app).get(`${ADDRESS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${customerBToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ADDRESS_NOT_FOUND");
  });

  it("updates an owned address", async () => {
    const created = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const res = await request(app)
      .patch(`${ADDRESS_URL}/${created.body.data.id}`)
      .set("Authorization", `Bearer ${customerAToken}`)
      .send({ city: "Pune" });
    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe("Pune");
  });

  it("returns 404 when updating a non-owned address", async () => {
    const created = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const res = await request(app)
      .patch(`${ADDRESS_URL}/${created.body.data.id}`)
      .set("Authorization", `Bearer ${customerBToken}`)
      .send({ city: "Pune" });
    expect(res.status).toBe(404);
  });

  it("sets an address as default via the dedicated endpoint", async () => {
    await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    const second = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Office" }));

    const res = await request(app).patch(`${ADDRESS_URL}/${second.body.data.id}/default`).set("Authorization", `Bearer ${customerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(true);

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    expect(list.body.data.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
  });

  it("leaves exactly one default address under concurrent default-switch requests", async () => {
    const first = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    const second = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Office" }));

    const [resA, resB] = await Promise.all([
      request(app).patch(`${ADDRESS_URL}/${first.body.data.id}/default`).set("Authorization", `Bearer ${customerAToken}`),
      request(app).patch(`${ADDRESS_URL}/${second.body.data.id}/default`).set("Authorization", `Bearer ${customerAToken}`)
    ]);

    expect([resA.status, resB.status]).toEqual([200, 200]);
    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    expect(list.body.data.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
  });

  it("deletes a non-default address without affecting the default", async () => {
    const first = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    const second = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Office" }));

    const res = await request(app).delete(`${ADDRESS_URL}/${second.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);
    expect(res.status).toBe(200);

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(first.body.data.id);
    expect(list.body.data[0].isDefault).toBe(true);
  });

  it("promotes the lowest remaining numeric ID to default when the default is deleted", async () => {
    const first = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Home" }));
    const second = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Office" }));
    await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload({ label: "Other" }));

    await request(app).delete(`${ADDRESS_URL}/${first.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    const defaults = list.body.data.filter((a: { isDefault: boolean }) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.body.data.id);
  });

  it("leaves the customer with no addresses after deleting the only one", async () => {
    const only = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    await request(app).delete(`${ADDRESS_URL}/${only.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);

    const list = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
    expect(list.body.data).toHaveLength(0);
  });

  it("rejects unsetting the default via PATCH when it would leave zero defaults", async () => {
    const only = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const res = await request(app)
      .patch(`${ADDRESS_URL}/${only.body.data.id}`)
      .set("Authorization", `Bearer ${customerAToken}`)
      .send({ isDefault: false });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ADDRESS_DEFAULT_REQUIRED");
  });

  it("rejects a malformed numeric address ID", async () => {
    const res = await request(app).get(`${ADDRESS_URL}/not-a-number`).set("Authorization", `Bearer ${customerAToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ADDRESS_ID");
  });

  it("rejects malformed address creation payloads", async () => {
    const res = await request(app)
      .post(ADDRESS_URL)
      .set("Authorization", `Bearer ${customerAToken}`)
      .send(validAddressPayload({ recipientName: "", phone: "not-a-phone-#$%" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
  });

  it("fully isolates addresses between customers across list/get/update/delete", async () => {
    const aAddress = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
    const bAddress = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerBToken}`).send(validAddressPayload());

    expect((await request(app).get(`${ADDRESS_URL}/${bAddress.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`)).status).toBe(404);
    expect(
      (await request(app).delete(`${ADDRESS_URL}/${aAddress.body.data.id}`).set("Authorization", `Bearer ${customerBToken}`)).status
    ).toBe(404);
    expect((await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`)).body.data).toHaveLength(1);
  });
});
