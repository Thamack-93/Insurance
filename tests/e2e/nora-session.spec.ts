import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test.describe("Nora browser session", () => {
  test("keeps a bounded draft when moving from the panel to the workspace", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/today");
    await page.getByRole("button", { name: "Abrir Nora" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder(/Pregunta por una póliza/i)).toBeVisible();
    const input = dialog.getByPlaceholder(/Pregunta por una póliza/i);
    await input.fill("renovaciones en 30 días");
    await dialog.getByRole("button", { name: "Abrir Nora en espacio completo" }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.locator("#main-content").getByPlaceholder(/Pregunta por una póliza/i)).toHaveValue("renovaciones en 30 días");
  });

  test("does not confirm the same Nora mutation twice on a double click", async ({ page }) => {
    let confirmations = 0;
    await page.route("**/api/assistant", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          response: {
            reply: "Revisa esta propuesta antes de confirmar.",
            source: "local",
            sections: [],
            quickPrompts: [],
            reportId: null,
            reportThemeKey: null,
            reportThemeLabel: null,
            actionProposal: {
              draftId: "draft-double-click",
              entityType: "receipt",
              operation: "update",
              title: "Registrar pago",
              summary: "Pago de prueba",
              targetLabel: "REC-TEST",
              changes: [{ label: "Monto", before: "$0.00", after: "$100.00" }],
              confirmLabel: "Confirmar pago",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        }),
      });
    });
    await page.route("**/api/assistant/actions/confirm", async (route) => {
      confirmations += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, result: { ok: true, message: "Pago confirmado." } }),
      });
    });

    await authenticatePageAsAdmin(page);
    await page.goto("/assistant");
    const input = page.getByPlaceholder(/Pregunta por una póliza/i);
    await input.fill("registrar pago");
    await input.press("Enter");
    const confirmButton = page.getByRole("button", { name: "Confirmar pago" });
    await expect(confirmButton).toBeVisible();
    await confirmButton.dblclick();
    await expect.poll(() => confirmations).toBe(1);
    await expect(page.getByRole("button", { name: "Confirmado" })).toBeVisible();
  });
});
