import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupSeededReceipt,
  cleanupRecentRenewalWorkItems,
  getTestDb,
  getAdminSessionCookie,
  getTestOrigin,
} from "../helpers/db";

test.describe("Commissions API", () => {
  test.describe("GET /api/commissions/stats", () => {
    test("returns 401 without session", async ({ request }) => {
      const response = await request.get("/api/commissions/stats");
      expect(response.status()).toBe(401);
    });

    test("returns commission statistics with session", async ({ request }) => {
      const authCookie = await getAdminSessionCookie();
      const response = await request.get("/api/commissions/stats", {
        headers: { cookie: authCookie },
      });

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
    let seeded: Awaited<ReturnType<typeof seedPendingReceipt>> | undefined;
    let commissionId = "";
    let startedAt = 0;

    test.beforeEach(async () => {
      startedAt = Date.now();
      seeded = await seedPendingReceipt("COMM-API");
      receiptId = seeded.id;
      policyId = seeded.policyId;

      const db = getTestDb();
      await db.receipt.update({
        where: { id: receiptId },
        data: { status: "PAID" },
      });

      const receipt = await db.receipt.findUnique({
        where: { id: receiptId },
      });

      if (!receipt) {
        throw new Error("Receipt not found");
      }

      await db.commission.create({
        data: {
          policyId,
          clientId: receipt.clientId,
          insurerId: receipt.insurerId,
          receiptId: receipt.id,
          expectedAmount: Number(receipt.amount) * 0.1,
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
        await cleanupRecentRenewalWorkItems(policyId, startedAt);
      }
      if (receiptId) {
        if (seeded) await cleanupSeededReceipt(seeded);
      }
    });

    test("returns 401 without session", async ({ request }) => {
      const response = await request.post(`/api/commissions/${commissionId}/status`, {
        data: { status: "PAID", actualAmount: 95 },
      });
      expect(response.status()).toBe(401);
    });

    test("updates commission status to PAID with session", async ({ request }) => {
      const authCookie = await getAdminSessionCookie();
      const response = await request.post(`/api/commissions/${commissionId}/status`, {
        headers: { cookie: authCookie, origin: getTestOrigin() },
        data: { status: "PAID", actualAmount: 95 },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });
});
