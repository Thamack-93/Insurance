import { expect, test } from "@playwright/test";

const enabled = process.env.RESTORE_DRILL_APP_SMOKE === "1";
const email = process.env.RESTORE_DRILL_FIXTURE_EMAIL ?? "";
const password = process.env.RESTORE_DRILL_FIXTURE_PASSWORD ?? "";
const agentEmail = process.env.RESTORE_DRILL_AGENT_EMAIL ?? "";
const agentPassword = process.env.RESTORE_DRILL_AGENT_PASSWORD ?? "";

test.describe("restored database application smoke", () => {
  test.skip(!enabled || !email || !password || !agentEmail || !agentPassword, "RESTORE_DRILL_APP_SMOKE is opt-in.");

  test("loads critical operational screens with the dedicated fixture", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/correo/i).fill(email);
    await page.getByLabel(/contraseña/i).fill(password);
    await page.getByRole("button", { name: /entrar|iniciar sesión|acceder/i }).click();
    await expect(page).toHaveURL(/\/today/);

    for (const route of ["/today", "/clients", "/policies", "/receipts", "/operations", "/reports", "/settings/users"]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toContainText(/database url|provider diagnostics|stack trace/i);
    }

    await page.goto("/assistant");
    await expect(page.locator("body")).not.toContainText(/provider diagnostics|api key|database url/i);

    await page.getByRole("button", { name: /cerrar sesión/i }).click();
    await page.getByLabel(/correo/i).fill(agentEmail);
    await page.getByLabel(/contraseña/i).fill(agentPassword);
    await page.getByRole("button", { name: /entrar|iniciar sesión|acceder/i }).click();
    await expect(page).toHaveURL(/\/today/);
    await page.goto("/clients");
    await expect(page.getByText("Restore Drill Scoped Client")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/provider diagnostics|api key|database url/i);
  });
});
