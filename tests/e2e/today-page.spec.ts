import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test.describe("Today operations center", () => {
  test("opens Today from the root and exposes the operational shell", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: /Buen día|Buenas tardes|Buenas noches/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enfoque ahora" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Insights" })).toBeVisible();
    await expect(page.getByText("PolicyDesk").first()).toBeVisible();
  });

  test("keeps mobile navigation keyboard-operable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticatePageAsAdmin(page);
    await page.goto("/today");

    await page.getByRole("button", { name: "Abrir menú de navegación" }).click();
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: "Hoy" }).last()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Abrir menú de navegación" })).toBeFocused();
  });

  test("captures responsive Today artifacts", async ({ page }, testInfo) => {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "tablet", width: 1024, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ];
    await authenticatePageAsAdmin(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/today");
      await page.screenshot({ path: testInfo.outputPath(`today-${viewport.name}.png`), fullPage: true });
    }
  });
});
