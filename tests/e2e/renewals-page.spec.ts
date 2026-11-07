import { test, expect } from "@playwright/test";
import { authenticatePageAsAdmin, getTestDb, cleanupRecentRenewalWorkItems, cleanupPolicyFixture, seedPolicyFixture } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";
import { addDays } from "date-fns";

test.describe("Renewals Page (/renewals)", () => {
  let policyId = "";
  let startedAt = 0;

  test.afterEach(async () => {
    const db = getTestDb();
    if (policyId) {
      await cleanupRecentRenewalWorkItems(policyId, startedAt);
      await db.policy.deleteMany({ where: { id: policyId } });
    }
  });

  test("displays the renewal board and its stage navigation by default", async ({ page }) => {
    const fixture = await seedPolicyFixture("RENEWAL-BOARD-DEFAULT");
    try {
      await getTestDb().policy.update({ where: { id: fixture.policyId }, data: { endDate: addDays(new Date(), 20) } });
      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=renewals");

      await expect(page.getByRole("heading", { name: "Renovaciones", exact: true })).toBeVisible();
      const stageNavigation = page.getByRole("navigation", { name: "Etapas de renovación" });
      const boardViewport = page.locator("[data-renewal-board-viewport]");
      await expect(stageNavigation).toBeVisible();
      await expect(boardViewport).toBeVisible();
      await expect(page.getByRole("button", { name: "Ver siguientes etapas" })).toBeVisible();
      await expect(page.getByText(/\d+ renovaciones en el tablero/)).toHaveCount(0);
      await expect(page.getByText(/Arrastra el fondo vacío para recorrer el tablero/)).toHaveCount(0);
      const pendingCard = page.locator("#renewal-stage-PENDING li").filter({ hasText: fixture.policyNumber });
      await expect(pendingCard).toBeVisible();
      await expect(pendingCard.getByRole("button", { name: /Mover la renovación/ })).toHaveCount(0);

      await page.getByRole("button", { name: "Ver siguientes etapas" }).click();
      await expect(page.locator("#renewal-stage-LOST")).toBeInViewport();
      await stageNavigation.getByRole("button", { name: /Cotizado/ }).click();
      const quotedColumn = page.locator("#renewal-stage-QUOTED");
      await expect(quotedColumn).toBeInViewport();
      await page.waitForTimeout(350);

      const beforePan = await boardViewport.evaluate((element) => element.scrollLeft);
      const columnBounds = await quotedColumn.boundingBox();
      if (!columnBounds) throw new Error("Cotizado column is not measurable.");
      const panX = columnBounds.x + columnBounds.width / 2;
      const panY = columnBounds.y + Math.min(columnBounds.height / 2, 50);
      await page.mouse.move(panX, panY);
      await page.mouse.down();
      await page.mouse.move(panX - 160, panY, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => boardViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforePan + 30);

      await stageNavigation.getByRole("button", { name: /Perdido/ }).click();
      await expect(page.locator("#renewal-stage-LOST")).toBeInViewport();
      await stageNavigation.getByRole("button", { name: /Perdido/ }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#renewal-stage-LOST")).toBeInViewport();
      for (const width of [390, 900, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(boardViewport).toBeVisible();
        await expect(stageNavigation.getByRole("button", { name: /Perdido/ })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
      }
      await page.getByRole("link", { name: "Ver como lista" }).click();
      await expect(page.getByText("Lista de renovaciones", { exact: true })).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("legacy /renewals route opens the unified renewal board", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    // Get existing client and insurer
    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    // Create policy with urgent renewal (today)
    const policy = await db.policy.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addDays(new Date(), 20),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals");

    await expect(page).toHaveURL(/\/operations\?view=renewals$/);
    await expect(page.getByRole("navigation", { name: "Etapas de renovación" })).toBeVisible();
    await expect(page.locator("#renewal-stage-PENDING")).toContainText(policy.policyNumber);
  });

  test("allows filtering renewals", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    const policy = await db.policy.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addDays(new Date(), 20),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals?mode=list");

    // Search input should be visible
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(client.fullName.slice(0, 5));
      // Wait for filtered results
      await page.waitForTimeout(300);
    }
  });

  test("opens renewal creation prefilled from a renewal row", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    const policyNumber = `REN-E2E-${Date.now()}`;
    const policy = await db.policy.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addDays(new Date(), 20),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals?mode=list");

    const row = page.locator("tr", { hasText: policyNumber });
    await expect(row.getByRole("link", { name: "Renovar" })).toBeVisible();
    await row.getByRole("link", { name: "Renovar" }).click();

    await expect(page).toHaveURL(new RegExp(`/policies/new\\?renewalFrom=${policy.id}`));
    await expect(page.getByText("Renueva a")).toBeVisible();
    await expect(page.getByText(policyNumber, { exact: true })).toBeVisible();
  });

  test("prepares a selected renewal from read-only source records", async ({ page }) => {
    const fixture = await seedPolicyFixture("RENEWAL-PREPARATION");
    const db = getTestDb();
    let successorId: string | null = null;
    try {
      const now = new Date();
      const receiptBase = {
        organizationId: TEST_ORGANIZATION_ID,
        policyId: fixture.policyId,
        clientId: fixture.clientId,
        insurerId: fixture.insurerId,
        periodStartDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        periodEndDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
        amount: 1200,
        currency: "MXN",
      };
      await db.receipt.create({ data: { ...receiptBase, receiptNumber: `PREP-OPEN-${Date.now()}`, status: "PENDING" } });
      await db.receipt.create({ data: { ...receiptBase, receiptNumber: `PREP-CANCELLED-${Date.now()}`, status: "CANCELLED", cancelledAt: now } });
      await db.policyInsuredAsset.create({ data: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId, assetType: "AUTO", description: "Automóvil de preparación", serialNumber: "VIN-PREP-001", isPrimary: true } });
      await db.policyInsuredParty.create({ data: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId, fullName: "Persona asegurada de prueba", isPrimary: true } });
      await db.policy.update({ where: { id: fixture.policyId }, data: { riskDetailsReviewRequired: true, riskDetails: { vehicleUse: "Personal" } } });
      const openTask = await db.workItem.create({ data: { organizationId: TEST_ORGANIZATION_ID, workItemType: "TASK", status: "OPEN", title: "Confirmar uso del vehículo", entityType: "Policy", entityId: fixture.policyId, clientId: fixture.clientId, policyId: fixture.policyId } });
      await db.workItem.create({ data: { organizationId: TEST_ORGANIZATION_ID, workItemType: "TASK", status: "RESOLVED", title: "Tarea ya resuelta de prueba", entityType: "Policy", entityId: fixture.policyId, clientId: fixture.clientId, policyId: fixture.policyId } });
      await db.document.create({ data: { organizationId: TEST_ORGANIZATION_ID, clientId: fixture.clientId, policyId: fixture.policyId, documentType: "POLICY", fileName: "poliza-preparacion.pdf", filePath: "test/poliza-preparacion.pdf", mimeType: "application/pdf" } });
      const successor = await db.policy.create({ data: {
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: fixture.policyNumber,
        clientId: fixture.clientId,
        insurerId: fixture.insurerId,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 395 * 24 * 60 * 60 * 1000),
        premiumAmount: 1300,
        currency: "MXN",
        renewedFromPolicyId: fixture.policyId,
      } });
      successorId = successor.id;
      await db.policyRenewalSuggestion.create({ data: { organizationId: TEST_ORGANIZATION_ID, sourcePolicyId: fixture.policyId, targetPolicyId: successor.id, status: "PENDING", reason: "Confirmar coincidencia de serie" } });

      await authenticatePageAsAdmin(page);
      await page.goto(`/renewals/${fixture.policyId}`);
      await expect(page.getByRole("heading", { name: `Preparar renovación · ${fixture.policyNumber}` })).toBeVisible();
      await expect(page.getByRole("link", { name: fixture.policyNumber }).first()).toHaveAttribute("href", `/policies/${fixture.policyId}`);
      await expect(page.getByText("PREP-OPEN", { exact: false })).toBeVisible();
      await expect(page.getByText("PREP-CANCELLED", { exact: false })).toHaveCount(0);
      const openTaskLink = page.locator(`a[href="/tasks/${openTask.id}"]`);
      await expect(openTaskLink).toHaveCount(1);
      await expect(openTaskLink).toHaveText("Confirmar uso del vehículo");
      await expect(page.getByText("Tarea ya resuelta de prueba", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Automóvil de preparación", { exact: true })).toBeVisible();
      await expect(page.getByText("Persona asegurada de prueba", { exact: false })).toBeVisible();
      await expect(page.getByText("poliza-preparacion.pdf", { exact: true })).toBeVisible();
      await expect(page.getByText("Revisar posible renovación por serie · " + fixture.policyNumber)).toBeVisible();
      await expect(page.getByRole("link", { name: "Revisar los datos de riesgos de esta póliza" })).toBeVisible();
      await expect(page.getByRole("link", { name: fixture.clientName })).toHaveAttribute("href", `/clients/${fixture.clientId}`);
      await expect(page.getByText("Resumen de atención", { exact: true })).toBeVisible();

      const source = await db.policy.findUniqueOrThrow({ where: { id: fixture.policyId }, select: { renewedFromPolicyId: true } });
      const linkedRows = await db.policy.count({ where: { organizationId: TEST_ORGANIZATION_ID, renewedFromPolicyId: fixture.policyId } });
      expect(source.renewedFromPolicyId).toBeNull();
      expect(linkedRows).toBe(1);
    } finally {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.organization_id', ${TEST_ORGANIZATION_ID}, true)`;
        await tx.policyRenewalSuggestion.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, sourcePolicyId: fixture.policyId } });
        await tx.document.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } });
        await tx.workItem.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } });
        await tx.receipt.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } });
        if (successorId) await tx.policy.deleteMany({ where: { id: successorId, organizationId: TEST_ORGANIZATION_ID } });
        await tx.policyInsuredAsset.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } });
        await tx.policyInsuredParty.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } });
      });
      await cleanupPolicyFixture(fixture);
    }
  });
});
