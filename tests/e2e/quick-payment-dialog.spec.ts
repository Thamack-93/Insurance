import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupSeededReceipt,
  cleanupRecentRenewalWorkItems,
  getTestDb,
  authenticatePageAsAdmin,
  type SeededReceipt,
} from "../helpers/db";
import { captureServerAction } from "../helpers/capture-server-action";

test.describe("Quick payment dialog (/receipts cobrar tab)", () => {
  let seeded: SeededReceipt | undefined;
  let startedAt = 0;

  function requireSeededReceipt() {
    if (!seeded) {
      throw new Error("Seeded receipt is missing for this test.");
    }

    return seeded;
  }

  test.beforeEach(async () => {
    startedAt = Date.now();
    seeded = await seedPendingReceipt("QPAY");
  });

  test.afterEach(async () => {
    if (seeded) {
      await cleanupSeededReceipt(seeded);
      await cleanupRecentRenewalWorkItems(seeded.policyId, startedAt);
    }
  });

  test("pays a receipt via the dialog and updates DB state", async ({ page }) => {
    const currentSeeded = requireSeededReceipt();
    await authenticatePageAsAdmin(page);
    // Navigate filtered to the seeded receipt so it's visible on page 1.
    await page.goto(`/receipts?tab=cobrar&q=${encodeURIComponent(currentSeeded.receiptNumber)}`);

    // Confirm row is rendered.
    await expect(page.getByRole("link", { name: currentSeeded.receiptNumber })).toBeVisible();

    // Open the QuickPaymentDialog (button labeled "Pagar").
    await page.getByRole("button", { name: /^pagar$/i }).first().click();

    // Dialog should display the receipt context.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(currentSeeded.receiptNumber).first()).toBeVisible();

    // Confirm payment — primary button starts with "Pagar " followed by the formatted amount.
    const action = await captureServerAction(page, () => page.getByRole("button", { name: /^pagar\s/i }).click());
    console.log("Quick payment server action:", action);

    // Dialog closes after success.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    // After router.refresh(), the row should disappear from the cobrar listing.
    await expect(page.getByRole("link", { name: currentSeeded.receiptNumber })).toHaveCount(0, {
      timeout: 10_000,
    });

    // DB state should be PAID.
    const db = getTestDb();
    const receipt = await db.receipt.findUnique({ where: { id: currentSeeded.id } });
    expect(receipt?.status).toBe("PAID");
  });
});
