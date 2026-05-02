import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupReceipt,
  cleanupRecentRenewalTasks,
  getTestDb,
  type SeededReceipt,
} from "../helpers/db";

test.describe("Quick payment dialog (/receipts cobrar tab)", () => {
  let seeded: SeededReceipt;
  let startedAt: number;

  test.beforeEach(async () => {
    startedAt = Date.now();
    seeded = await seedPendingReceipt("QPAY");
  });

  test.afterEach(async () => {
    await cleanupReceipt(seeded.id);
    await cleanupRecentRenewalTasks(seeded.policyId, startedAt);
  });

  test("pays a receipt via the dialog, shows a toast and updates DB state", async ({ page }) => {
    // Navigate filtered to the seeded receipt so it's visible on page 1.
    await page.goto(`/receipts?tab=cobrar&q=${encodeURIComponent(seeded.receiptNumber)}`);

    // Confirm row is rendered.
    await expect(page.getByRole("link", { name: seeded.receiptNumber })).toBeVisible();

    // Open the QuickPaymentDialog (button labeled "Pagar").
    await page.getByRole("button", { name: /^pagar$/i }).first().click();

    // Dialog should display the receipt context.
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(seeded.receiptNumber).first()).toBeVisible();

    // Confirm payment — primary button starts with "Pagar " followed by the formatted amount.
    await page.getByRole("button", { name: /^pagar\s/i }).click();

    // Sonner toast appears with the success message.
    await expect(page.getByText(/pago registrado exitosamente/i)).toBeVisible({ timeout: 10_000 });

    // Dialog closes after success.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    // After router.refresh(), the row should disappear from the cobrar listing.
    await expect(page.getByRole("link", { name: seeded.receiptNumber })).toHaveCount(0, {
      timeout: 10_000,
    });

    // DB state should be PAID.
    const db = getTestDb();
    const receipt = await db.receipt.findUnique({ where: { id: seeded.id } });
    expect(receipt?.status).toBe("PAID");
  });
});
