import { test, expect } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test.describe("Payments route redirect (/payments/new)", () => {
  test("redirects to the cobranza view and renders it", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/payments/new");

    await page.waitForURL("**/receipts?tab=cobrar");
    await expect(page.getByRole("heading", { name: "Recibos y pagos", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Cobrar" })).toBeVisible();
  });
});
