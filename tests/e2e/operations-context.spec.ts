import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
import { expectMutationSuccessToast } from "../helpers/assert-mutation-toast";
import { captureServerAction } from "../helpers/capture-server-action";

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
      const activePolicyLink = page.getByRole("link", { name: new RegExp(fixture.policyNumber) });
      await expect(activePolicyLink).toBeVisible();
      await expect(activePolicyLink).toHaveAttribute("href", new RegExp(`^/policies/${fixture.policyId}(?:\\?.*)?$`));
      await expect(page.getByText("Renovaciones vencidas sin resolver", { exact: true })).toBeVisible();

      await db.policy.update({ where: { id: fixture.policyId }, data: { status: "EXPIRED" } });
      await page.goto("/policies?status=EXPIRED");
      const expiredPolicyLink = page.getByRole("link", { name: new RegExp(fixture.policyNumber) });
      await expect(expiredPolicyLink).toBeVisible();
      await expect(expiredPolicyLink).toHaveAttribute("href", `/policies/${fixture.policyId}`);
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

      await expect(page.getByRole("link", { name: new RegExp(fixture.policyNumber) })).toHaveCount(0);
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
      const shortcutDate = businessDateAfter(3);
      await page.getByRole("menuitem", { name: "En 3 días", exact: true }).click();

      await expectMutationSuccessToast(page, "Seguimiento programado.");
      await expect.poll(async () => {
        const item = await db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId } } });
        return item
          ? { status: item.status, policyId: item.policyId, dueDate: businessDateKey(item.dueDate!), notes: item.notes }
          : null;
      }, { timeout: 10_000 }).toEqual({ status: "OPEN", policyId: fixture.policyId, dueDate: shortcutDate, notes: null });
      await expect(card.getByText(/Seguimiento ·/)).toBeVisible({ timeout: 10_000 });

      await card.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` }).click();
      await page.getByRole("menuitem", { name: "Otra fecha", exact: true }).click();
      const customDate = businessDateAfter(5);
      await page.getByLabel("Fecha de seguimiento").fill(customDate);
      await page.getByLabel("Nota opcional").fill("Llamar después de la junta");
      await page.getByRole("button", { name: "Guardar seguimiento", exact: true }).click();

      await expectMutationSuccessToast(page, "Seguimiento reprogramado.");
      await expect.poll(async () => {
        const rows = await db.workItem.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId } });
        return rows.length === 1
          ? { count: rows.length, dueDate: businessDateKey(rows[0].dueDate!), notes: rows[0].notes, policyId: rows[0].policyId }
          : { count: rows.length };
      }, { timeout: 10_000 }).toEqual({ count: 1, dueDate: customDate, notes: "Llamar después de la junta", policyId: fixture.policyId });
      await expect(card.getByText(/Seguimiento ·/)).toBeVisible({ timeout: 10_000 });

      await card.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` }).click();
      await page.getByRole("menuitem", { name: "Quitar seguimiento", exact: true }).click();
      const confirmDialog = page.getByRole("alertdialog").filter({ hasText: `Quitar seguimiento de ${fixture.policyNumber}` });
      await confirmDialog.getByRole("button", { name: "Quitar seguimiento", exact: true }).click();
      await expectMutationSuccessToast(page, "Seguimiento eliminado.");
      await expect.poll(async () => {
        const item = await db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId } } });
        return item ? { status: item.status, dueDate: businessDateKey(item.dueDate!) } : null;
      }, { timeout: 10_000 }).toEqual({ status: "CANCELLED", dueDate: customDate });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("edits and cancels an ordinary WorkItem from Operations without changing its identity", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-EDIT-WORKITEM");
    const sourceId = `e2e-ordinary-work-item-${Date.now()}`;
    const title = `Pendiente ordinario ${Date.now()}`;

    try {
      await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "WorkItem",
          sourceId,
          workItemType: "TASK",
          taskType: "GENERAL",
          status: "OPEN",
          priority: "MEDIUM",
          title,
          entityType: "WorkItem",
          entityId: sourceId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=pending");
      await page.getByRole("link", { name: `Editar pendiente: ${title}` }).click();
      await expect(page).toHaveURL((url) => url.pathname === `/tasks/${sourceId}/edit`);
      await page.getByLabel("Estado", { exact: true }).click();
      await page.getByRole("option", { name: "Cancelado", exact: true }).click();
      const action = await captureServerAction(page, () => page.getByRole("button", { name: "Guardar cambios", exact: true }).click());
      console.log("WorkItem update server action:", action);

      await expect.poll(async () => {
        const item = await db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "WorkItem", sourceId } } });
        return item ? { status: item.status, sourceType: item.sourceType, sourceId: item.sourceId, title: item.title } : null;
      }, { timeout: 10_000 }).toEqual({ status: "CANCELLED", sourceType: "WorkItem", sourceId, title });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});
