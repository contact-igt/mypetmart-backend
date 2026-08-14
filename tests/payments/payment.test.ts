
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { PaymentService, PaymentAttemptAlreadyActiveError, OrderAlreadyPaidError } from "../../src/models/PaymentModels/index.js";

describe("Payment Attempt Domain Foundation", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  async function createTestOrder(overrides: Partial<Order> = {}): Promise<Order> {
    return sequelize.transaction(async (t) => {
      const orderId = await IdSequenceService.allocateNextId("orders", t);
      return Order.create(
        {
          id: orderId,
          order_number: `ORD-TEST-${orderId}`,
          status: "pending",
          payment_status: "pending",
          fulfilment_status: "unfulfilled",
          subtotal: "100.00",
          shipping_fee: "0.00",
          total: "100.00",
          currency: "INR",
          ship_recipient_name: "Test User",
          ship_phone: "9999999999",
          ship_line_1: "Test Line 1",
          ship_city: "Test City",
          ship_state: "Test State",
          ship_postal_code: "111111",
          ship_country: "IN",
          contact_email: "test@example.com",
          ...overrides
        },
        { transaction: t }
      );
    });
  }

  it("1. Creates first Payment Attempt for valid pending Order, snapshotting amount and currency", async () => {
    const order = await createTestOrder({ total: "550.00", currency: "INR" });

    const attempt = await PaymentService.createPaymentAttempt({ orderId: order.id });

    expect(attempt).toBeDefined();
    expect(attempt.order_id).toBe(order.id);
    expect(attempt.amount).toBe("550.00");
    expect(attempt.currency).toBe("INR");
    expect(attempt.status).toBe("pending");
    expect(attempt.provider).toBe("payu");
    
    // Provider IDs and payload remain null before PayU interaction
    expect(attempt.provider_order_id).toBeNull();
    expect(attempt.provider_payment_id).toBeNull();
    expect(attempt.method).toBeNull();
    expect(attempt.raw_payload).toBeNull();

    // Verify Order state did not mutate
    await order.reload();
    expect(order.status).toBe("pending");
    expect(order.payment_status).toBe("pending");
  });

  it("2. Blocks duplicate active attempt (concurrency rejection)", async () => {
    const order = await createTestOrder();

    // Create the first active attempt
    await PaymentService.createPaymentAttempt({ orderId: order.id });

    // Attempting again should throw
    await expect(PaymentService.createPaymentAttempt({ orderId: order.id }))
      .rejects.toThrow(PaymentAttemptAlreadyActiveError);
  });

  it("3. Rapid concurrent create requests result in one active attempt safely", async () => {
    const order = await createTestOrder();

    // Fire 5 concurrent requests
    const results = await Promise.allSettled([
      PaymentService.createPaymentAttempt({ orderId: order.id }),
      PaymentService.createPaymentAttempt({ orderId: order.id }),
      PaymentService.createPaymentAttempt({ orderId: order.id }),
      PaymentService.createPaymentAttempt({ orderId: order.id }),
      PaymentService.createPaymentAttempt({ orderId: order.id })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed due to row locks
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(PaymentAttemptAlreadyActiveError);
      }
    }

    const attempts = await Payment.findAll({ where: { order_id: order.id } });
    expect(attempts).toHaveLength(1);
  });

  it("4. Failed attempt allows retry (new pending attempt)", async () => {
    const order = await createTestOrder();

    const attempt1 = await PaymentService.createPaymentAttempt({ orderId: order.id });
    
    // Simulate failure
    await attempt1.update({ status: "failed", failed_at: new Date() });

    // Retry should succeed
    const attempt2 = await PaymentService.createPaymentAttempt({ orderId: order.id });
    expect(attempt2.id).not.toBe(attempt1.id);
    expect(attempt2.status).toBe("pending");

    const attempts = await Payment.findAll({ where: { order_id: order.id } });
    expect(attempts).toHaveLength(2);
  });

  it("5. Cancelled attempt allows retry (new pending attempt)", async () => {
    const order = await createTestOrder();

    const attempt1 = await PaymentService.createPaymentAttempt({ orderId: order.id });
    
    // Simulate cancellation
    // Need to bypass TS strictness if cancelled wasn't available in types during test write, but it is now in types
    await attempt1.update({ status: "cancelled" });

    // Retry should succeed
    const attempt2 = await PaymentService.createPaymentAttempt({ orderId: order.id });
    expect(attempt2.id).not.toBe(attempt1.id);
    expect(attempt2.status).toBe("pending");

    const attempts = await Payment.findAll({ where: { order_id: order.id } });
    expect(attempts).toHaveLength(2);
  });

  it("6. Successful/paid Order blocks new attempt", async () => {
    const order = await createTestOrder({ payment_status: "paid" });

    await expect(PaymentService.createPaymentAttempt({ orderId: order.id }))
      .rejects.toThrow(OrderAlreadyPaidError);
  });

  it("7. Order with successful Payment row blocks new attempt even if Order.payment_status is out of sync", async () => {
    const order = await createTestOrder({ payment_status: "pending" });

    const attempt1 = await PaymentService.createPaymentAttempt({ orderId: order.id });
    await attempt1.update({ status: "paid", paid_at: new Date() });

    // Order still pending, but payment is paid. Should block.
    await expect(PaymentService.createPaymentAttempt({ orderId: order.id }))
      .rejects.toThrow(OrderAlreadyPaidError);
  });
});
