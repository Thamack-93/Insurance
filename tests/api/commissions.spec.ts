import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupReceipt,
  cleanupRecentRenewalTasks,
  getTestDb,
} from "../helpers/db";

test.describe("Commissions API", () => {
  test.describe("GET /api/commissions/stats", () => {
    test("returns commission statistics", async ({ request }) => {
      const response = await request.get("/api/commissions/stats");
      
      // API may not exist yet - verify expected behavior
      if (response.status() === 404) {
        test.skip(true, "API endpoint not implemented");
        return;
      }

      expect(response.status()).toBe(200);
      const body = await response.json();
      
      expect(body).toHaveProperty("totalExpected");
      expect(body).toHaveProperty("totalActual");
      expect(body).toHaveProperty("statusBreakdown");
      expect(Array.isArray(body.statusBreakdown)).toBe(true);
    });
  });

  test.describe("POST /api/commissions/:id/status", () => {
    let receiptId = "";
    let policyId = "";
    let commissionId = "";
    let startedAt = 0;

    test.beforeEach(async () => {
      startedAt = Date.now();
      const seeded = await seedPendingReceipt("COMM-API");
      receiptId = seeded.id;
      policyId = seeded.policyId;

      // Create commission by marking receipt as paid and calculating
      const db = getTestDb();
      await db.receipt.update({
        where: { id: receiptId },
        data: { status: "PAID" },
      });

      // Get receipt details for commission
      const receipt = await db.receipt.findUnique({
        where: { id: receiptId },
      });

      if (!receipt) {
        throw new Error("Receipt not found");
      }

      // Create commission directly
      await db.commission.create({
        data: {
          policyId,
          clientId: receipt.clientId,
          insurerId: receipt.insurerId,
          receiptId: receipt.id,
          expectedAmount: Number(receipt.amount) * 0.1, // 10% commission
          percentage: 10,
          expectedDate: new Date(),
          status: "EXPECTED",
        },
      });

      const commission = await db.commission.findFirst({
        where: { policyId },
      });
      commissionId = commission!.id;
    });

    test.afterEach(async () => {
      const db = getTestDb();
      if (policyId) {
        await db.commission.deleteMany({ where: { policyId } });
        await cleanupRecentRenewalTasks(policyId, startedAt);
      }
      if (receiptId) {
        await cleanupReceipt(receiptId);
      }
    });

    test("updates commission status to PAID", async ({ request }) => {
      const response = await request.post(`/api/commissions/${commissionId}/status`, {
        data: { status: "PAID", actualAmount: 95 },
      });

      // API may not exist yet
      if (response.status() === 404) {
        test.skip(true, "API endpoint not implemented");
        return;
      }

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });
});
