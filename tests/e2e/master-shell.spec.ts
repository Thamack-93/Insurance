import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, authenticatePageAsAgent } from "../helpers/db";

const mainDestinations = ["Hoy", "Operación", "Clientes", "Pólizas", "Recibos", "Comisiones y bonos", "Reportes"];

test.describe("PolicyDesk master shell", () => {
  test("shows exactly seven destinations and persists the collapsed sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await authenticatePageAsAdmin(page);
    await page.goto("/today");

    const sidebar = page.locator("aside");
    const navigation = sidebar.getByRole("navigation", { name: "Navegación principal" });
    await expect(navigation.getByRole("link")).toHaveCount(7);
    for (const destination of mainDestinations) {
      await expect(navigation.getByRole("link", { name: destination, exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Colapsar menú lateral" }).click();
    await expect(page.getByRole("button", { name: "Expandir menú lateral" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expandir menú lateral" })).toBeVisible();
  });

  test("keeps legacy links canonical and opens the unified operation center", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/tasks?q=renovacion");
    await expect(page).toHaveURL(/\/operations\?.*q=renovacion.*view=pending/);
    await expect(page.getByRole("heading", { name: "Pendientes", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pendientes", exact: true })).toHaveAttribute("aria-current", "page");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/today\?view=insights/);
    await expect(page.getByRole("heading", { name: "Visión operativa y financiera" })).toBeVisible();
  });

  test("maps every legacy section to the correct primary destination", async ({ page }) => {
    await authenticatePageAsAdmin(page);

    const cases = [
      { path: "/renewals", url: /\/operations\?.*view=renewals/, destination: "Operación" },
      { path: "/claims", url: /\/operations\?.*view=claims/, destination: "Operación" },
      { path: "/quotes", url: /\/quotes(?:\?|$)/, destination: "Pólizas" },
      { path: "/due-payments", url: /\/receipts\?.*tab=cobrar/, destination: "Recibos" },
      { path: "/portfolio", url: /\/portfolio(?:\?|$)/, destination: "Reportes" },
    ] as const;

    for (const legacyCase of cases) {
      await page.goto(legacyCase.path);
      await expect(page).toHaveURL(legacyCase.url);
      await expect(
        page
          .locator("aside")
          .getByRole("navigation", { name: "Navegación principal" })
          .getByRole("link", { name: legacyCase.destination, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  });

  test("opens Nora as a contextual panel and previews authorized Excel reports", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await authenticatePageAsAdmin(page);
    await page.goto("/today");

    await page.getByRole("button", { name: "Abrir Nora" }).click();
    const noraDialog = page.getByRole("dialog");
    await expect(noraDialog.getByText("Asistente operativo")).toBeVisible();
    await expect(page.getByPlaceholder(/Pregunta por una póliza/)).toBeVisible();
    const dialogBox = await noraDialog.boundingBox();
    expect(dialogBox?.width).toBeGreaterThanOrEqual(500);
    expect(dialogBox?.width).toBeLessThanOrEqual(560);
    await expect.poll(() => noraDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Excel", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Generar reporte con Nora" })).toBeVisible();
    await expect(page.getByText("Cobranza vencida", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Renovaciones próximas/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Cartera activa/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("nora-report-preview.png"), fullPage: true });
  });

  test("generates filtered reports in place instead of navigating to operational pages", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/reports");

    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reporte de cobranza" })).toBeVisible();
    await expect(page.getByLabel("Alcance")).toBeVisible();
    await page.getByRole("button", { name: "Vista previa" }).click();
    await expect(page.getByText(/registros listos para descargar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Descargar Excel" })).toBeVisible();
    await expect(page).toHaveURL(/\/reports(?:\?|$)/);
  });

  test("hides Administration for agents without hiding their own profile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticatePageAsAgent(page);
    await page.goto("/today");
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("link", { name: "Administración" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Perfil" })).toBeVisible();

    await page.goto("/data-quality");
    await expect(page).toHaveURL(/\/today$/);
  });
});
