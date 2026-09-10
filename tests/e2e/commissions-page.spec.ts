import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupSeededReceipt,
  cleanupRecentRenewalWorkItems,
  getTestDb,
  authenticatePageAsAdmin,
} from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test.describe("Commissions Page (/commissions)", () => {
  let receiptId = "";
  let policyId = "";
  let seeded: Awaited<ReturnType<typeof seedPendingReceipt>> | undefined;
  let startedAt = 0;

  test.beforeEach(async () => {
    startedAt = Date.now();
    seeded = await seedPendingReceipt("COMM-E2E");
    receiptId = seeded.id;
    policyId = seeded.policyId;
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

  test("displays commission statistics", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/commissions");

    // Wait for page to load - check for main title
    await expect(page.getByRole("heading", { name: "Comisiones y bonos", exact: true })).toBeVisible();

    // Check for metric cards
    await expect(page.getByText("Esperado").first()).toBeVisible();
    await expect(page.getByText("Cobrado").first()).toBeVisible();
  });

  test("shows open commissions list", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    // Create a commission by marking receipt as paid and creating commission directly
    const db = getTestDb();
    await db.receipt.update({
      where: { id: receiptId },
      data: { status: "PAID" },
    });

    // Get policy details to create commission
    const policy = await db.policy.findUnique({
      where: { id: policyId },
      include: { client: true, insurer: true }
    });

    if (policy) {
      // Create commission record directly
      await db.commission.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          policyId,
          clientId: policy.clientId,
          insurerId: policy.insurerId,
          receiptId,
          expectedAmount: Number(policy.premiumAmount) * 0.1, // 10% commission
          percentage: 10,
          expectedDate: new Date(),
          status: "PENDING",
        },
      });
    }

    await page.goto("/commissions");

    // Wait for commissions table
    await expect(page.getByText("Comisiones abiertas")).toBeVisible();
  });
});
