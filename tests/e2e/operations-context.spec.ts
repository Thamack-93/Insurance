import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

function businessDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Etc/GMT+6",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function businessDateAfter(days: number) {
  return businessDateKey(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

test.describe("operation queue context", () => {
  test("resolves legacy renewal context and links to the policy", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS");
    const policy = await db.policy.findUnique({ where: { id: fixture.policyId }, select: { id: true, clientId: true, insurerId: true, policyNumber: true } });

    const sourceId = `e2e-legacy-renewal-${Date.now()}`;
    let workItemId: string | null = null;

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { endDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const workItem = await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Renovación: ${policy!.policyNumber}`,
          entityType: "POLICY",
          entityId: policy!.id,
          clientId: null,
          policyId: null,
          insurerId: null,
          dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });
      workItemId = workItem.id;

      await authenticatePageAsAdmin(page);
      await page.goto("/operations");

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación(?: vencida)? · ${policy!.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText(fixture.clientName);
      await expect(renewalLink).toContainText(fixture.insurerName);
      await expect(renewalLink).toContainText("Venció");
      await expect(renewalLink).toContainText("Vencida");
      await expect(renewalLink).toContainText("Abrir póliza");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}?returnTo=%2Foperations`);
      expect((await renewalLink.innerText()).split(policy!.policyNumber)).toHaveLength(2);

      await renewalLink.click();
      await expect(page).toHaveURL(new RegExp(`/policies/${policy!.id}(?:\\?.*)?$`));
      await expect(page.getByRole("heading", { name: policy!.policyNumber, exact: true })).toBeVisible();
    } finally {
      if (workItemId) await db.workItem.delete({ where: { id: workItemId } }).catch(() => undefined);
      await cleanupPolicyFixture(fixture);
    }
  });

  test("resolves the current renewal work item reference and shows the renewal date", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-CURRENT");
    const policy = await db.policy.findUnique({ where: { id: fixture.policyId }, select: { id: true, policyNumber: true, endDate: true } });
    const reference = `policy:${policy!.id}:renewal-workItem`;
    let workItemId: string | null = null;

    try {
      const workItem = await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: reference,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Renovación: ${policy!.policyNumber}`,
          entityType: "WORKITEM",
          entityId: reference,
          clientId: null,
          policyId: null,
          insurerId: null,
          dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });
      workItemId = workItem.id;

      await authenticatePageAsAdmin(page);
      await page.goto("/operations");

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación(?: vencida)? · ${policy!.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText(fixture.clientName);
      await expect(renewalLink).toContainText(fixture.insurerName);
      await expect(renewalLink).toContainText("Renueva");
      await expect(renewalLink).toContainText("Abrir póliza");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}?returnTo=%2Foperations`);
    } finally {
      if (workItemId) await db.workItem.delete({ where: { id: workItemId } }).catch(() => undefined);
      await cleanupPolicyFixture(fixture);
    }
  });

  test("resolves a task-backed renewal from its policy number", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-TASK-RENEWAL");
    const sourceId = `legacy-renewal-task-${Date.now()}`;
    let workItemId: string | null = null;

    try {
      const workItem = await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Task",
          sourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Renovación: ${fixture.policyNumber}`,
          entityType: "WorkItem",
          entityId: sourceId,
          clientId: null,
          policyId: null,
          insurerId: null,
          dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
          startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });
      workItemId = workItem.id;

      await authenticatePageAsAdmin(page);
      await page.goto("/operations");

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación(?: vencida)? · ${fixture.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText(fixture.clientName);
      await expect(renewalLink).toContainText(fixture.insurerName);
      await expect(renewalLink).toContainText("Renueva");
      await expect(renewalLink).toContainText("Abrir póliza");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${fixture.policyId}?returnTo=%2Foperations`);
      expect((await renewalLink.innerText()).split(fixture.policyNumber)).toHaveLength(2);
    } finally {
      if (workItemId) await db.workItem.delete({ where: { id: workItemId } }).catch(() => undefined);
      await cleanupPolicyFixture(fixture);
    }
  });

  test("links unresolved overdue renewals to a complete operational list and preserves expired history", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("RENEWAL-RISK");

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { endDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/policies");

      const riskLink = page.getByRole("link", { name: /Renovaciones vencidas sin resolver:/ });
      await expect(riskLink).toBeVisible();
      await expect(riskLink).toHaveAttribute("href", "/operations?view=renewals");

      await riskLink.click();
      await expect(page).toHaveURL(/\/operations\?view=renewals$/);
      await expect(page.getByRole("link", { name: fixture.policyNumber, exact: true })).toBeVisible();
      await expect(page.getByText("Renovaciones vencidas sin resolver", { exact: true })).toBeVisible();

      await db.policy.update({ where: { id: fixture.policyId }, data: { status: "EXPIRED" } });
      await page.goto("/policies?status=EXPIRED");
      await expect(page.getByRole("link", { name: fixture.policyNumber, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Vigencias terminadas", exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Fin de vigencia" })).toBeVisible();
      await expect(page.getByRole("cell", { name: /Terminó:/ }).first()).toBeVisible();
      await expect(page.getByText("Vigencias terminadas para consulta histórica", { exact: false })).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("excludes an overdue renewal whose latest receipt is cancelled", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("RENEWAL-CANCELLED-RECEIPT");

    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await db.policy.update({ where: { id: fixture.policyId }, data: { endDate: yesterday } });
      await db.receipt.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          receiptNumber: `CANCELLED-${Date.now()}`,
          policyId: fixture.policyId,
          clientId: fixture.clientId,
          insurerId: fixture.insurerId,
          periodStartDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          periodEndDate: yesterday,
          dueDate: yesterday,
          amount: 1234.56,
          currency: "MXN",
          status: "CANCELLED",
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=renewals");

      await expect(page.getByRole("link", { name: fixture.policyNumber, exact: true })).toHaveCount(0);
      await expect(page.getByText("No hay renovaciones pendientes.", { exact: true })).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("schedules and reschedules one manual renewal follow-up from the board", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("RENEWAL-MANUAL-FOLLOWUP");
    const sourceId = `policy:${fixture.policyId}:renewal-manual-followup`;

    try {
      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=renewal-board");

      const card = page.locator("li").filter({ hasText: fixture.policyNumber }).first();
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` }).click();
      await page.getByRole("menuitem", { name: "En 3 días", exact: true }).click();

      await expect(card.getByText(/Seguimiento ·/)).toBeVisible();
      const first = await db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId } } });
      expect(first?.status).toBe("OPEN");
      expect(first?.policyId).toBe(fixture.policyId);
      expect(businessDateKey(first!.dueDate!)).toBe(businessDateAfter(3));

      await card.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` }).click();
      await page.getByRole("menuitem", { name: "Otra fecha", exact: true }).click();
      const customDate = businessDateAfter(5);
      await page.getByLabel("Fecha de seguimiento").fill(customDate);
      await page.getByLabel("Nota opcional").fill("Llamar después de la junta");
      await page.getByRole("button", { name: "Guardar seguimiento", exact: true }).click();

      await expect(card.getByText(/Seguimiento ·/)).toBeVisible();
      const rows = await db.workItem.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId } });
      expect(rows).toHaveLength(1);
      expect(businessDateKey(rows[0].dueDate!)).toBe(customDate);
      expect(rows[0].notes).toBe("Llamar después de la junta");
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});
