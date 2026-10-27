/* eslint-disable */
// Final PayU minimum payable safety guard (₹1.00): pure boundary rules, then
// Checkout Preview, Order creation and PayU initiation end to end. The Global
// Pay Online Discount ₹1 merchandise cap and coupon maths are exercised only
// to prove they are unchanged.
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockedShippingConfig = vi.hoisted(() => ({
  provider: "ithink",
  accessToken: "test-access-token",
  secretKey: "test-secret-key",
  apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
  trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
  storeId: "test-store",
  pickupAddressId: "test-pickup",
  returnAddressId: "test-return",
  originPincode: "400001",
  timeoutMs: 1_000,
  ready: true
}));
vi.mock("../../src/config/shipping.config.js", () => ({ shippingConfig: mockedShippingConfig }));

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Refund } from "../../src/database/tables/RefundTable/index.js";
import { ReturnRequest } from "../../src/database/tables/ReturnRequestTable/index.js";
import { Coupon, CouponRedemption } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";
import { CouponPricingService } from "../../src/models/CouponModels/coupon.service.js";
import { SettingsService } from "../../src/models/SettingsModels/settings.service.js";
import { calculateGlobalOnlinePaymentDiscount, type OnlinePaymentDiscountConfig } from "../../src/models/CheckoutModels/online-payment-discount.js";
import { isBelowPrepaidMinimum, meetsPrepaidMinimum, MIN_PREPAID_PAYABLE_PAISE } from "../../src/models/CheckoutModels/prepaid-minimum.js";

type Eligibility = "both" | "payu" | "cod";

const CART_URL = "/api/v1/storefront/cart";
const PREVIEW_URL = "/api/v1/storefront/checkout/preview";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADDRESS = { recipientName: "Min Payable Test", phone: "9876543210", line1: "1 Test Road", city: "Mumbai", state: "Maharashtra", postalCode: "400001" };
const EMAIL = "min-payable@example.com";
const FIXED_100: OnlinePaymentDiscountConfig = { enabled: true, discountType: "fixed", discountValue: 10_000 };

// Pure pricing in the same order as checkout/order creation:
// subtotal → coupon → Pay Online discount → + shipping.
function price(subtotalPaise: number, couponPaise: number, configuration = FIXED_100, shippingPaise = 0) {
  const online = calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: subtotalPaise - couponPaise, paymentMethod: "payu", configuration }).discountAmountPaise;
  const finalPaise = subtotalPaise - couponPaise - online + shippingPaise;
  return { online, finalPaise, payuAllowed: !isBelowPrepaidMinimum("payu", finalPaise) };
}

describe("PayU minimum payable — pure rules", () => {
  it("§19 exact boundary: 100 paise allowed, 99 rejected", () => {
    expect(MIN_PREPAID_PAYABLE_PAISE).toBe(100);
    expect(meetsPrepaidMinimum(100)).toBe(true);
    expect(meetsPrepaidMinimum(99)).toBe(false);
    expect(isBelowPrepaidMinimum("payu", 100)).toBe(false);
    expect(isBelowPrepaidMinimum("payu", 99)).toBe(true);
  });

  it("§8/§11 never applies to COD or an omitted (legacy) payment method", () => {
    expect(isBelowPrepaidMinimum("cod", 0)).toBe(false);
    expect(isBelowPrepaidMinimum(undefined, 0)).toBe(false);
    expect(isBelowPrepaidMinimum(null, 50)).toBe(false);
  });

  it.each([
    ["CASE 1 ₹1, no coupon, fixed ₹100", 100, 0, 0, 100],
    ["CASE 2 ₹45, no coupon, fixed ₹100", 4_500, 0, 4_400, 100],
    ["CASE 4 ₹1,000, no coupon, fixed ₹100", 100_000, 0, 10_000, 90_000],
    ["CASE 5 ₹101, coupon ₹1, fixed ₹100", 10_100, 100, 9_900, 100],
    ["CASE 6 ₹100, coupon ₹99, fixed ₹100", 10_000, 9_900, 0, 100]
  ])("%s → PayU allowed", (_label, subtotal, coupon, expectedOnline, expectedFinal) => {
    const result = price(subtotal, coupon);
    expect(result.online).toBe(expectedOnline);
    expect(result.finalPaise).toBe(expectedFinal);
    expect(result.payuAllowed).toBe(true);
  });

  it("CASE 3 ₹499 at 100% → discount ₹498, final ₹1, PayU allowed", () => {
    const result = price(49_900, 0, { enabled: true, discountType: "percentage", discountValue: 10_000 });
    expect(result).toEqual({ online: 49_800, finalPaise: 100, payuAllowed: true });
  });

  it.each([
    ["CASE 7 ₹100, coupon ₹100", 10_000, 10_000, 0],
    ["CASE 8 ₹100, coupon ₹99.50", 10_000, 9_950, 50],
    ["§18 ₹0.50 product, no coupon", 50, 0, 50]
  ])("%s → online ₹0, PayU BLOCKED", (_label, subtotal, coupon, expectedFinal) => {
    const result = price(subtotal, coupon);
    expect(result.online).toBe(0);
    expect(result.finalPaise).toBe(expectedFinal);
    expect(result.payuAllowed).toBe(false);
  });

  it("coupon calculation is unchanged: a ₹100 fixed coupon on ₹100 is still ₹100 (§3)", () => {
    expect(CouponPricingService.calculateDiscountPaise("fixed", 10_000, 10_000, null)).toBe(10_000);
    expect(CouponPricingService.calculateDiscountPaise("fixed", 9_950, 10_000, null)).toBe(9_950);
  });

  it("§20 shipping counts: ₹0 merchandise + ₹50 shipping is a ₹50 provider amount, allowed", () => {
    expect(price(10_000, 10_000, FIXED_100, 5_000)).toEqual({ online: 0, finalPaise: 5_000, payuAllowed: true });
  });
});

let categoryId: number;
let counter = 0;

async function clearAll(): Promise<void> {
  await Refund.destroy({ where: {}, force: true });
  await ReturnRequest.destroy({ where: {}, force: true });
  await CouponRedemption.destroy({ where: {}, force: true });
  await Payment.destroy({ where: {}, force: true });
  await OrderItem.destroy({ where: {}, force: true });
  await Order.destroy({ where: {}, force: true });
  await Coupon.destroy({ where: {}, force: true });
  await CartItem.destroy({ where: {}, force: true });
  await Cart.destroy({ where: {}, force: true });
  await Product.destroy({ where: {}, force: true });
  await Category.destroy({ where: {}, force: true });
}

async function createProduct(price: string, eligibility: Eligibility = "both"): Promise<Product> {
  counter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id, category_id: categoryId, name: `MinPay Product ${counter}`, slug: `minpay-product-${counter}-${Date.now()}`, sku: `MINPAY-${counter}-${Date.now()}`,
        description: "d", pet_type: "all", status: "active", price, compare_at_price: null, stock: 20, has_variants: false, featured: false,
        payment_method_eligibility: eligibility
      } as never,
      { transaction: t }
    );
  });
}

async function createCoupon(discountPaise: number, eligibility: Eligibility = "both"): Promise<Coupon> {
  counter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("coupons", t);
    return Coupon.create({ id, code: `MINPAY${counter}`, name: `MinPay coupon ${counter}`, discount_type: "fixed", discount_value: discountPaise, status: "active", payment_method_eligibility: eligibility } as never, { transaction: t });
  });
}

async function guestWith(product: Product, couponCode?: string) {
  const guest = request.agent(app);
  await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
  if (couponCode) {
    const applied = await guest.post(`${CART_URL}/coupon`).send({ code: couponCode });
    expect(applied.status).toBe(200);
  }
  return guest;
}
const preview = (guest: ReturnType<typeof request.agent>, paymentMethod: "payu" | "cod") =>
  guest.post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod });
const placeOrder = (guest: ReturnType<typeof request.agent>, paymentMethod?: "payu" | "cod") =>
  guest.post(ORDERS_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, ...(paymentMethod ? { paymentMethod } : {}) });

describe("PayU minimum payable — checkout, order creation, PayU initiation", () => {
  beforeAll(async () => { await connectDatabase(); await clearAll(); });
  afterAll(async () => {
    await SettingsService.updatePayOnlineDiscountSettings({ enabled: false, discountType: "percentage", discountValue: "0" });
    await clearAll();
    await disconnectDatabase();
  });
  beforeEach(async () => {
    await clearAll();
    await SettingsService.updatePayOnlineDiscountSettings({ enabled: false, discountType: "percentage", discountValue: "0" });
    categoryId = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("categories", t);
      return (await Category.create({ id, name: "MinPay Category", slug: `minpay-cat-${Date.now()}-${counter}`, description: "d", pet_type: "all", active: true, display_order: 1 }, { transaction: t })).id;
    });
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("CASE 7: coupon brings PayU to ₹0 → preview blocks, coupon amount unchanged, COD unaffected", async () => {
    const product = await createProduct("100.00");
    const coupon = await createCoupon(10_000);
    const guest = await guestWith(product, coupon.code);

    const payu = await preview(guest, "payu");
    expect(payu.status).toBe(200);
    expect(payu.body.data.totals.discountAmount).toBe("100.00");
    expect(payu.body.data.totals.payableTotal).toBe("0.00");
    expect(payu.body.data.readiness.paymentReady).toBe(false);
    expect(payu.body.data.readiness.orderReady).toBe(false);
    expect(payu.body.data.prepaidMinimumPayable).toEqual({
      code: "PREPAID_MINIMUM_PAYABLE_NOT_MET",
      message: "Online payment requires a minimum payable amount of ₹1.00.",
      minimumPayable: "1.00",
      actualPayable: "0.00"
    });

    const cod = await preview(guest, "cod");
    expect(cod.body.data.prepaidMinimumPayable).toBeNull();
    expect(cod.body.data.totals.payableTotal).toBe("0.00");
    expect(cod.body.data.readiness.orderReady).toBe(true);
  });

  it("CASE 7: PayU order creation is rejected with 422 and nothing is persisted", async () => {
    const product = await createProduct("100.00");
    const coupon = await createCoupon(10_000);
    const guest = await guestWith(product, coupon.code);

    const res = await placeOrder(guest, "payu");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PREPAID_MINIMUM_PAYABLE_NOT_MET");
    expect(res.body.error.details).toEqual({ minimumPayable: "1.00", actualPayable: "0.00" });
    expect(await Order.count()).toBe(0);
    expect(await OrderItem.count()).toBe(0);
    expect(await CouponRedemption.count()).toBe(0);
    expect(await Payment.count()).toBe(0);
    expect((await Product.findByPk(product.id))!.stock).toBe(20);
  });

  it("CASE 8 and §18: ₹0.50 PayU totals are blocked in preview and order creation", async () => {
    const couponCase = await guestWith(await createProduct("100.00"), (await createCoupon(9_950)).code);
    expect((await preview(couponCase, "payu")).body.data.prepaidMinimumPayable?.actualPayable).toBe("0.50");
    expect((await placeOrder(couponCase, "payu")).status).toBe(422);

    const subRupee = await guestWith(await createProduct("0.50"));
    const payu = await preview(subRupee, "payu");
    expect(payu.body.data.totals.onlinePaymentDiscountAmount).toBe("0.00");
    expect(payu.body.data.prepaidMinimumPayable?.actualPayable).toBe("0.50");
    expect((await placeOrder(subRupee, "payu")).status).toBe(422);
    expect(await Order.count()).toBe(0);
  });

  it("§19: exactly ₹1.00 PayU is allowed end to end (CASE 6)", async () => {
    const guest = await guestWith(await createProduct("100.00"), (await createCoupon(9_900)).code);
    const payu = await preview(guest, "payu");
    expect(payu.body.data.totals.payableTotal).toBe("1.00");
    expect(payu.body.data.prepaidMinimumPayable).toBeNull();
    expect(payu.body.data.readiness.orderReady).toBe(true);

    const created = await placeOrder(guest, "payu");
    expect(created.status).toBe(201);
    expect(created.body.data.total).toBe("1.00");
    const initiated = await guest.post("/api/v1/storefront/payments/initiate").send({ guestAccessToken: created.body.data.guestAccessToken });
    expect(initiated.status).toBe(200);
    const payment = await Payment.findOne({ where: { order_id: created.body.data.id } });
    expect(payment!.amount).toBe("1.00"); // Payment.amount === Order.total, never rewritten
  });

  it("CASE 1 with the Global Pay Online Discount enabled: ₹1 product keeps ₹1.00 and PayU is allowed", async () => {
    await SettingsService.updatePayOnlineDiscountSettings({ enabled: true, discountType: "fixed", discountValue: "100" });
    const guest = await guestWith(await createProduct("1.00"));
    const payu = await preview(guest, "payu");
    expect(payu.body.data.totals.onlinePaymentDiscountAmount).toBe("0.00");
    expect(payu.body.data.totals.payableTotal).toBe("1.00");
    expect(payu.body.data.prepaidMinimumPayable).toBeNull();
    expect((await placeOrder(guest, "payu")).status).toBe(201);
  });

  it("§11/§22 legacy pending Order (no paymentMethod) below ₹1: PayU initiation rejects, no Payment, coupon stays reserved, stock unchanged", async () => {
    const product = await createProduct("100.00");
    const coupon = await createCoupon(10_000);
    const guest = await guestWith(product, coupon.code);

    const created = await placeOrder(guest);
    expect(created.status).toBe(201);
    expect(created.body.data.total).toBe("0.00");

    const payu = await guest.post("/api/v1/storefront/payments/initiate").send({ guestAccessToken: created.body.data.guestAccessToken });
    expect(payu.status).toBe(422);
    expect(payu.body.error.code).toBe("PREPAID_MINIMUM_PAYABLE_NOT_MET");
    expect(await Payment.count({ where: { order_id: created.body.data.id } })).toBe(0);
    expect((await CouponRedemption.findOne({ where: { order_id: created.body.data.id } }))!.status).toBe("reserved");
    expect((await Product.findByPk(product.id))!.stock).toBe(20);
    const order = await Order.findByPk(created.body.data.id);
    expect(order!.status).toBe("pending");
    expect(order!.payment_status).toBe("pending");
    expect(order!.total).toBe("0.00"); // never rewritten to ₹1
  });

  it("§15 no Pay Online offer when the alternative PayU total would be below ₹1", async () => {
    // PayU-only ₹99.50 coupon: COD ₹100.00 vs PayU ₹0.50 — a "saving", but PayU can't be paid.
    const guest = await guestWith(await createProduct("100.00"), (await createCoupon(9_950, "payu")).code);
    const cod = await preview(guest, "cod");
    expect(cod.status).toBe(200);
    expect(cod.body.data.totals.payableTotal).toBe("100.00");
    expect(cod.body.data.onlinePaymentOffer).toBeNull();
  });

  it("§7 Case B: PayU-only cart below ₹1 is blocked and never offered COD", async () => {
    const guest = await guestWith(await createProduct("100.00", "payu"), (await createCoupon(10_000)).code);
    const payu = await preview(guest, "payu");
    expect(payu.body.data.allowedPaymentMethods).toEqual(["payu"]);
    expect(payu.body.data.prepaidMinimumPayable?.code).toBe("PREPAID_MINIMUM_PAYABLE_NOT_MET");
    expect(payu.body.data.readiness.orderReady).toBe(false);
    expect(payu.body.data.cashOnDeliveryOffer).toBeNull();
  });
});
