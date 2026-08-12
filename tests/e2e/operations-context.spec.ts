import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

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
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}`);
      expect((await renewalLink.innerText()).split(policy!.policyNumber)).toHaveLength(2);

      await renewalLink.click();
      await expect(page).toHaveURL(new RegExp(`/policies/${policy!.id}$`));
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
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}`);
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
      await expect(renewalLink).toHaveAttribute("href", `/policies/${fixture.policyId}`);
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
});
