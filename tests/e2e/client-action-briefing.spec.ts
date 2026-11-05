import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test("shows client priorities in Operations and links the briefing to each source record", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("CLIENT-BRIEFING");
  let workItemId: string | null = null;
  let claimId: string | null = null;

  try {
    const now = new Date();
    await db.policy.update({
      where: { id: fixture.policyId },
      data: { endDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000), renewalStage: "PENDING" },
    });
    const receipt = await db.receipt.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        receiptNumber: `CAB-R-${Date.now()}`,
        policyId: fixture.policyId,
        clientId: fixture.clientId,
        insurerId: fixture.insurerId,
        periodStartDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        periodEndDate: new Date(now.getTime() + 335 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        amount: 1234.56,
        currency: "MXN",
        status: "OVERDUE",
      },
      select: { id: true, receiptNumber: true },
    });
    const task = await db.workItem.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        sourceType: "WorkItem",
        sourceId: `client-briefing-task-${Date.now()}`,
        workItemType: "TASK",
        taskType: "GENERAL",
        status: "OPEN",
        priority: "HIGH",
        title: "Llamar por documentos pendientes",
        entityType: "Task",
        entityId: `client-briefing-task-${Date.now()}`,
        clientId: fixture.clientId,
        policyId: fixture.policyId,
        dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    workItemId = task.id;
    const claim = await db.claim.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        folio: `CAB-C-${Date.now()}`,
        clientId: fixture.clientId,
        policyId: fixture.policyId,
        insurerId: fixture.insurerId,
        claimType: "AUTO",
        status: "OPEN",
        incidentDate: now,
        reportedDate: now,
        dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
      select: { id: true, folio: true },
    });
    claimId = claim.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/operations");
    const overview = page.getByRole("region", { name: "Clientes que requieren atención" });
    await expect(overview).toBeVisible();
    await expect(overview.getByRole("link", { name: fixture.clientName, exact: true })).toHaveAttribute("href", `/clients/${fixture.clientId}`);

    await page.goto(`/clients/${fixture.clientId}`);
    const briefing = page.getByRole("region", { name: "Resumen de atención" });
    await expect(briefing).toBeVisible();
    const receiptLink = briefing.locator(`a[href="/receipts/${receipt.id}"]`);
    const renewalLink = briefing.locator(`a[href="/policies/${fixture.policyId}"]`).filter({ hasText: fixture.policyNumber });
    const taskLink = briefing.locator(`a[href="/tasks/${task.id}"]`);
    const claimLink = briefing.locator(`a[href="/claims/${claim.id}"]`);
    await expect(receiptLink).toBeVisible();
    await expect(renewalLink).toBeVisible();
    await expect(taskLink).toBeVisible();
    await expect(claimLink).toBeVisible();
    await expect(briefing.getByText("$1,234.56", { exact: true })).toBeVisible();

    for (const [link, expectedUrl] of [
      [receiptLink, `/receipts/${receipt.id}`],
      [renewalLink, `/policies/${fixture.policyId}`],
      [taskLink, `/tasks/${task.id}`],
      [claimLink, `/claims/${claim.id}`],
    ] as const) {
      await link.click();
      await expect(page).toHaveURL(expectedUrl);
      await page.goBack();
      await expect(page.getByRole("region", { name: "Resumen de atención" })).toBeVisible();
    }
  } finally {
    if (claimId) await db.claim.deleteMany({ where: { id: claimId } });
    if (workItemId) await db.workItem.deleteMany({ where: { id: workItemId } });
    await cleanupPolicyFixture(fixture);
  }
});

test("shows the empty state for a client with no actionable records", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("CLIENT-BRIEFING-EMPTY");

  try {
    await db.policy.update({ where: { id: fixture.policyId }, data: { endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } });
    await authenticatePageAsAdmin(page);
    await page.goto(`/clients/${fixture.clientId}`);

    const briefing = page.getByRole("region", { name: "Resumen de atención" });
    await expect(briefing).toBeVisible();
    await expect(briefing.getByText("No hay pendientes importantes", { exact: true })).toBeVisible();
  } finally {
    await cleanupPolicyFixture(fixture);
  }
});
