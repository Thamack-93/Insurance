import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test.describe("Nora assistant", () => {
  test.use({ navigationTimeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/assistant");
  });

  test("renders as a focused chat instead of an admin dashboard", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Nora" })).toBeVisible();
    await expect(page.getByPlaceholder(/pregunta por una póliza/i)).toBeVisible();
    await expect(page.getByText("Pistas rápidas")).toHaveCount(0);
    await expect(page.getByText("Backlog de IA")).toHaveCount(0);
  });

  test("blocks unrelated questions before using the AI", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("Dame una receta de pasta");
    await input.press("Enter");

    await expect(page.getByText(/solo puedo ayudarte con información y flujos de PolicyDesk/i)).toBeVisible();
  });

  test("shows unlimited AI usage in the admin panel", async ({ page }) => {
    await page.goto("/settings/assistant");
    await expect(page.getByText("Rate limits IA")).toBeVisible();
    await expect(page.getByText("Sin límite", { exact: true })).toBeVisible();
  });

  test("turns a reported system failure into an admin incident", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("La captura de PDF no funciona");
    await input.press("Enter");

    await expect(page.getByText("Señal registrada", { exact: true })).toBeVisible();
    await page.goto("/settings/assistant?tab=incidentes");
    await expect(page.getByText(/INCIDENT · \d+ señales/).first()).toBeVisible();
  });
});
