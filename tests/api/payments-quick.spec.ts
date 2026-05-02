import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupReceipt,
  cleanupRecentRenewalTasks,
  getTestDb,
} from "../helpers/db";

test.describe("POST /api/payments/quick", () => {
  test("returns 400 with friendly error when required fields are missing", async ({ request }) => {
    const response = await request.post("/api/payments/quick", {
      data: {},
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("returns 400 when receipt id is unknown", async ({ request }) => {
    const response = await request.post("/api/payments/quick", {
      data: {
        receiptId: "non-existent-id-xxx",
        amount: 100,
        paidDate: new Date().toISOString().split("T")[0],
        paymentMethod: "TRANSFER",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/recibo/i);
  });

  test("returns 200 with success shape and marks receipt as paid", async ({ request }) => {
    const start = Date.now();
    const seeded = await seedPendingReceipt("APIT");

    try {
      const response = await request.post("/api/payments/quick", {
        data: {
          receiptId: seeded.id,
          amount: 1234.56,
          paidDate: new Date().toISOString().split("T")[0],
          paymentMethod: "TRANSFER",
        },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        success: true,
        redirectTo: `/receipts/${seeded.id}`,
      });
      expect(body.paymentId).toEqual(expect.any(String));
      expect(body.message).toMatch(/pago/i);

      // Verify the receipt is now PAID in the database.
      const db = getTestDb();
      const receipt = await db.receipt.findUnique({ where: { id: seeded.id } });
      expect(receipt?.status).toBe("PAID");
    } finally {
      await cleanupReceipt(seeded.id);
      await cleanupRecentRenewalTasks(seeded.policyId, start);
    }
  });

  test("returns 400 when the receipt is already paid", async ({ request }) => {
    const start = Date.now();
    const seeded = await seedPendingReceipt("APIT");

    try {
      // Pay the first time.
      const first = await request.post("/api/payments/quick", {
        data: {
          receiptId: seeded.id,
          amount: 1234.56,
          paidDate: new Date().toISOString().split("T")[0],
          paymentMethod: "TRANSFER",
        },
      });
      expect(first.status()).toBe(200);

      // Second attempt should fail with friendly error.
      const second = await request.post("/api/payments/quick", {
        data: {
          receiptId: seeded.id,
          amount: 1234.56,
          paidDate: new Date().toISOString().split("T")[0],
          paymentMethod: "TRANSFER",
        },
      });
      expect(second.status()).toBe(400);
      const body = await second.json();
      expect(body.error).toMatch(/pagado/i);
    } finally {
      await cleanupReceipt(seeded.id);
      await cleanupRecentRenewalTasks(seeded.policyId, start);
    }
  });
});
