import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test("renders operational insights using the tenant-scoped candidate query", async ({ page }) => {
  await authenticatePageAsAdmin(page);
  await page.goto("/reports/insights?group=all&page=1");

  await expect(page.getByRole("heading", { name: "Insights operativos", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumen de señales operativas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Casos accionables", exact: true })).toBeVisible();
});
