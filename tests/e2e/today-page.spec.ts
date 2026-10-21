import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test.describe("Today operations center", () => {
  test("opens Today from the root and exposes the operational shell", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: /Buen día|Buenas tardes|Buenas noches/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enfoque ahora" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Insights" })).toBeVisible();
    await expect(page.getByText("PolicyDesk").first()).toBeVisible();

    const summary = page.getByRole("region", { name: "Resumen operativo" });
    await expect(summary.getByRole("link")).toHaveCount(6);
    await expect(summary.getByText("Próx. 7 días", { exact: true })).toBeVisible();
    const quickActions = page.getByRole("region", { name: "Acciones rápidas" });
    await expect(quickActions.getByRole("button", { name: "Registrar pago" })).toBeVisible();
    await expect(quickActions.getByRole("link", { name: "Capturar póliza" })).toBeVisible();
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

  test("records collection follow-up and completes a WorkItem from Today", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("TODAY-FOCUS-ACTIONS");
    const workItemSourceId = `today-focus-${Date.now()}`;
    const dueDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    let receiptId: string | undefined;

    try {
      await db.policy.update({ where: { id: fixture.policyId }, data: { endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000) } });
      const receipt = await db.receipt.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          receiptNumber: `TODAY-${Date.now()}`,
          policyId: fixture.policyId,
          clientId: fixture.clientId,
          insurerId: fixture.insurerId,
          periodStartDate: dueDate,
          periodEndDate: dueDate,
          dueDate,
          amount: 1234.56,
          currency: "MXN",
          status: "PENDING",
        },
      });
      receiptId = receipt.id;
      await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "WorkItem",
          sourceId: workItemSourceId,
          workItemType: "TASK",
          taskType: "GENERAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: `Pendiente Today ${fixture.policyNumber}`,
          entityType: "WorkItem",
          entityId: workItemSourceId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          dueDate,
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/today");
      const queue = page.getByRole("region", { name: "Enfoque ahora" });
      await expect(queue.getByText(fixture.clientName, { exact: true })).toBeVisible();
      await queue.getByRole("button", { name: "Registrar seguimiento" }).click();
      await page.getByLabel("Resultado").selectOption("PROMISED_PAYMENT");
      const promisedDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await page.getByLabel("Fecha prometida de pago").fill(promisedDate);
      await page.getByLabel("Nota opcional").fill("Cliente confirma transferencia");
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(page.getByText("Seguimiento de cobranza guardado.")).toBeVisible();

      const collectionSourceId = `receipt:${receipt.id}:collection-followup`;
      await expect.poll(async () => {
        const [item, currentReceipt] = await Promise.all([
          db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Collection", sourceId: collectionSourceId } }, select: { status: true, notes: true, receiptId: true, dueDate: true } }),
          db.receipt.findUnique({ where: { id: receipt.id }, select: { status: true } }),
        ]);
        return { item: item && { status: item.status, notes: item.notes, receiptId: item.receiptId, dueDate: item.dueDate?.toISOString().slice(0, 10) }, receiptStatus: currentReceipt?.status };
      }, { timeout: 10_000 }).toEqual({
        item: { status: "OPEN", notes: "Cliente confirma transferencia", receiptId: receipt.id, dueDate: promisedDate },
        receiptStatus: "PENDING",
      });
      // A follow-up does not settle the receipt; it remains visible for payment work.
      await expect(queue.getByRole("button", { name: "Registrar seguimiento" }).first()).toBeVisible();
      await expect(queue.getByText(fixture.clientName, { exact: true }).first()).toBeVisible();

      const workItem = await db.workItem.findUniqueOrThrow({
        where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "WorkItem", sourceId: workItemSourceId } },
        select: { id: true, sourceType: true, sourceId: true },
      });
      await queue.getByRole("button", { name: "Completar pendiente" }).click();
      await expect(page.getByText("Pendiente completado.")).toBeVisible();
      await expect.poll(async () => db.workItem.findUnique({ where: { id: workItem.id }, select: { status: true, sourceType: true, sourceId: true } }), { timeout: 10_000 })
        .toEqual({ status: "RESOLVED", sourceType: workItem.sourceType, sourceId: workItem.sourceId });
      await expect(queue.getByRole("button", { name: "Completar pendiente" })).toHaveCount(0);
    } finally {
      if (receiptId) await db.receipt.deleteMany({ where: { id: receiptId, organizationId: TEST_ORGANIZATION_ID } });
      await cleanupPolicyFixture(fixture);
    }
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
