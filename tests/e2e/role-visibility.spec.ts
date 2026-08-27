import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, authenticatePageAsAgent, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

test.describe("role visibility smoke tests", () => {
  test("tenant admin does not see platform backup controls in settings", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
    await expect(page.getByText("Nora y reportes IA", { exact: true })).toBeVisible();
    await expect(page.getByText("Respaldos cifrados")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Crear respaldo ahora" })).toHaveCount(0);
  });

  test("agent does not see admin backup controls", async ({ page }) => {
    await authenticatePageAsAgent(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
    await expect(page.getByText("Respaldos cifrados")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Crear respaldo ahora" })).toHaveCount(0);
  });

  test("admin can reach the internal operational center and its tools", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/settings");

    await expect(page.getByText("Centro Operativo", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: /Abrir centro operativo/ }).click();
    await expect(page).toHaveURL(/\/settings\/centro-operativo$/);
    await expect(page.getByRole("heading", { name: "Centro Operativo", exact: true })).toBeVisible();

    for (const [path, heading] of [
      ["/insurers", "Aseguradoras"],
      ["/documents", "Documentos"],
      ["/risks", "Riesgos y calidad"],
      ["/data-quality", "Calidad de datos"],
      ["/activity", "Actividad y seguridad"],
    ] as const) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}(?:\\?.*)?$`));
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  });

  test("agents cannot see or open internal operational screens", async ({ page }) => {
    await authenticatePageAsAgent(page);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Centro Operativo", exact: true })).toHaveCount(0);

    for (const path of [
      "/settings/centro-operativo",
      "/insurers",
      "/risks",
      "/data-quality",
      "/activity",
      "/settings/assistant",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/today$/);
    }

    // Documents remain readable through the defensive tenant scope for agents;
    // only their write/internal-control surfaces stay admin-only.
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);
  });

  test("agent insurer links open the filtered portfolio", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("AGENT-INSURER");
    const agent = await db.user.findUnique({ where: { email: "ci-agent@policydesk.local" }, select: { id: true } });
    if (!agent) throw new Error("Agent fixture was not created");

    try {
      await db.client.update({ where: { id: fixture.clientId }, data: { portfolioOwnerId: agent.id } });
      await authenticatePageAsAgent(page);
      await page.goto("/portfolio");

      const insurerLink = page.locator(`a[href="/portfolio?insurerId=${encodeURIComponent(fixture.insurerId)}"]`).first();
      await expect(insurerLink).toBeVisible();
      await insurerLink.click();
      await expect(page).toHaveURL(new RegExp(`/portfolio\\?insurerId=${encodeURIComponent(fixture.insurerId)}`));
      await expect(page.getByRole("link", { name: fixture.clientName, exact: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: fixture.policyNumber, exact: true }).first()).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});
