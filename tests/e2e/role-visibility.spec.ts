import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, authenticatePageAsAgent } from "../helpers/db";

test.describe("role visibility smoke tests", () => {
  test("admin sees the backups panel in settings", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
    await expect(page.getByText("Respaldos cifrados")).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear respaldo ahora" })).toBeVisible();
  });

  test("agent does not see admin backup controls", async ({ page }) => {
    await authenticatePageAsAgent(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
    await expect(page.getByText("Respaldos cifrados")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Crear respaldo ahora" })).toHaveCount(0);
  });
});
