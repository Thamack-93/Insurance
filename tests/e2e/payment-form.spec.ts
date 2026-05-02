import { test, expect } from "@playwright/test";
import {
  seedPendingReceipt,
  cleanupReceipt,
  cleanupRecentRenewalTasks,
  type SeededReceipt,
} from "../helpers/db";

test.describe("Payment registration form (/payments/new)", () => {
  let seeded: SeededReceipt;
  let startedAt: number;

  test.beforeEach(async () => {
    startedAt = Date.now();
    seeded = await seedPendingReceipt("FORM");
  });

  test.afterEach(async () => {
    await cleanupReceipt(seeded.id);
    await cleanupRecentRenewalTasks(seeded.policyId, startedAt);
  });

  test("creates a payment, redirects to the receipt detail and marks it as paid", async ({ page }) => {
    await page.goto("/payments/new");

    // Form must render.
    await expect(page.getByRole("heading", { name: /registrar pago/i })).toBeVisible();

    // Open the receipt selector and pick our seeded receipt.
    await page.getByRole("combobox").first().click();
    const option = page.getByRole("option", { name: new RegExp(seeded.receiptNumber) });
    await option.click();

    // Submit the form.
    await page.getByRole("button", { name: /registrar pago/i }).click();

    // We should land on the receipt detail.
    await page.waitForURL(`**/receipts/${seeded.id}`, { timeout: 15_000 });

    // The receipt detail page should show a PAID indicator.
    await expect(page.getByText(/pagado/i).first()).toBeVisible({ timeout: 10_000 });

    // Receipt number should be visible somewhere on the page.
    await expect(page.getByText(seeded.receiptNumber).first()).toBeVisible();
  });

  test("shows a validation error when no receipt is selected", async ({ page }) => {
    await page.goto("/payments/new");

    await page.getByRole("button", { name: /registrar pago/i }).click();

    // The Zod validator should keep us on the same page and surface a per-field error.
    await expect(page.getByText(/recibo es requerido/i)).toBeVisible();
    expect(page.url()).toContain("/payments/new");
  });
});
