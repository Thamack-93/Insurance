import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, authenticatePageAsAgent, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
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
  test("filters pending relationships by selected client and policy", async ({ page }) => {
    const db = getTestDb();
    const first = await seedPolicyFixture("TASK-RELATION-FIRST");
    const second = await seedPolicyFixture("TASK-RELATION-SECOND");
    const now = new Date();
    const firstReceiptNumber = `TASK-REL-R1-${Date.now()}`;
    const alternateReceiptNumber = `TASK-REL-RA-${Date.now()}`;
    const secondReceiptNumber = `TASK-REL-R2-${Date.now()}`;
    const alternatePolicyNumber = `TEST-POL-ALT-${Date.now()}`;
    let alternatePolicyId: string | null = null;

    try {
      const alternatePolicy = await db.policy.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          policyNumber: alternatePolicyNumber,
          clientId: first.clientId,
          insurerId: first.insurerId,
          policyType: "AUTO",
          status: "ACTIVE",
          paymentFrequency: "ANNUAL",
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          premiumAmount: 2345.67,
          currency: "MXN",
        },
      });
      alternatePolicyId = alternatePolicy.id;

      await db.receipt.createMany({
        data: [
          {
            organizationId: TEST_ORGANIZATION_ID,
            receiptNumber: firstReceiptNumber,
            policyId: first.policyId,
            clientId: first.clientId,
            insurerId: first.insurerId,
            periodStartDate: now,
            periodEndDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            amount: 1000,
            currency: "MXN",
            status: "PENDING",
          },
          {
            organizationId: TEST_ORGANIZATION_ID,
            receiptNumber: alternateReceiptNumber,
            policyId: alternatePolicy.id,
            clientId: first.clientId,
            insurerId: first.insurerId,
            periodStartDate: now,
            periodEndDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            amount: 1500,
            currency: "MXN",
            status: "PENDING",
          },
          {
            organizationId: TEST_ORGANIZATION_ID,
            receiptNumber: secondReceiptNumber,
            policyId: second.policyId,
            clientId: second.clientId,
            insurerId: second.insurerId,
            periodStartDate: now,
            periodEndDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            amount: 2000,
            currency: "MXN",
            status: "PENDING",
          },
        ],
      });
      const firstReceipt = await db.receipt.findFirst({ where: { receiptNumber: firstReceiptNumber }, select: { id: true } });
      const editWorkItemId = `e2e-task-relations-${Date.now()}`;
      await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          id: editWorkItemId,
          sourceType: "Task",
          sourceId: editWorkItemId,
          workItemType: "TASK",
          taskType: "GENERAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: "Pending relationship edit fixture",
          entityType: "WorkItem",
          entityId: editWorkItemId,
          clientId: first.clientId,
          policyId: first.policyId,
          insurerId: first.insurerId,
          receiptId: firstReceipt!.id,
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/tasks/new");

      const clientSelect = page.getByRole("combobox", { name: "Cliente", exact: true });
      const policySelect = page.getByRole("combobox", { name: "Póliza", exact: true });
      const receiptSelect = page.getByRole("combobox", { name: "Recibo", exact: true });
      await expect(policySelect).toBeDisabled();
      await expect(receiptSelect).toBeDisabled();

      await clientSelect.click();
      await page.getByRole("option", { name: first.clientName, exact: true }).click();
      await policySelect.click();
      await expect(page.getByRole("option", { name: new RegExp(first.policyNumber) })).toHaveCount(1);
      await expect(page.getByRole("option", { name: new RegExp(alternatePolicyNumber) })).toHaveCount(1);
      await expect(page.getByRole("option", { name: new RegExp(second.policyNumber) })).toHaveCount(0);
      await page.getByRole("option", { name: new RegExp(first.policyNumber) }).click();

      await receiptSelect.click();
      await expect(page.getByRole("option", { name: firstReceiptNumber, exact: true })).toHaveCount(1);
      await expect(page.getByRole("option", { name: alternateReceiptNumber, exact: true })).toHaveCount(0);
      await expect(page.getByRole("option", { name: secondReceiptNumber, exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: firstReceiptNumber, exact: true }).click();

      await policySelect.click();
      await page.getByRole("option", { name: new RegExp(alternatePolicyNumber) }).click();
      await expect(receiptSelect).toBeEnabled();
      await expect(receiptSelect).toContainText("Sin recibo");
      await receiptSelect.click();
      await expect(page.getByRole("option", { name: alternateReceiptNumber, exact: true })).toHaveCount(1);
      await expect(page.getByRole("option", { name: firstReceiptNumber, exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");

      await clientSelect.click();
      await page.getByRole("option", { name: second.clientName, exact: true }).click();
      await expect(policySelect).toContainText("Sin póliza");
      await expect(receiptSelect).toBeDisabled();
      await policySelect.click();
      await expect(page.getByRole("option", { name: new RegExp(second.policyNumber) })).toHaveCount(1);
      await expect(page.getByRole("option", { name: new RegExp(first.policyNumber) })).toHaveCount(0);

      await page.goto(`/tasks/${editWorkItemId}/edit`);
      await expect(page.getByRole("combobox", { name: "Cliente", exact: true })).toContainText(first.clientName);
      await expect(page.getByRole("combobox", { name: "Póliza", exact: true })).toContainText(new RegExp(first.policyNumber));
      await expect(page.getByRole("combobox", { name: "Recibo", exact: true })).toContainText(firstReceiptNumber);
    } finally {
      if (alternatePolicyId) await db.policy.delete({ where: { id: alternatePolicyId } }).catch(() => undefined);
      await cleanupPolicyFixture(first);
      await cleanupPolicyFixture(second);
    }
  });

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
      await page.goto("/operations?view=renewals&mode=list");

      await expect(page.getByRole("link", { name: new RegExp(fixture.policyNumber) })).toHaveCount(0);
      await expect(page.getByText("No hay renovaciones pendientes.", { exact: true })).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("unifies renewal views and confirms drag-and-drop into Lost", async ({ page }) => {
    const fixture = await seedPolicyFixture("RENEWAL-BOARD-DRAG");

    try {
      await getTestDb().policy.update({
        where: { id: fixture.policyId },
        data: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
      });
      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=renewals");

      const stageNavigation = page.getByRole("navigation", { name: "Etapas de renovación" });
      await expect(stageNavigation.getByRole("button", { name: /Perdido/ })).toBeVisible();
      await page.getByRole("button", { name: "Ver como lista" }).click();
      await expect(page.getByRole("heading", { name: "Lista de renovaciones" })).toBeVisible();
      await page.getByRole("button", { name: "Ver como tablero" }).click();

      const pendingCard = page.locator("#renewal-stage-PENDING li").filter({ hasText: fixture.policyNumber });
      await expect(pendingCard).toBeVisible();
      await pendingCard.locator("[data-renewal-drag-handle]").dragTo(page.locator("#renewal-stage-CONTACTED"));
      await expectMutationSuccessToast(page, "Renovación movida a Contactado.");

      const contactedCard = page.locator("#renewal-stage-CONTACTED li").filter({ hasText: fixture.policyNumber });
      await expect(contactedCard).toBeVisible();
      await contactedCard.locator("[data-renewal-drag-handle]").dragTo(page.locator("#renewal-stage-LOST"));
      const confirmation = page.getByRole("alertdialog");
      await expect(confirmation).toContainText("Se marcará como no continuada");
      await confirmation.getByRole("button", { name: "Cancelar" }).click();
      await expect(contactedCard).toBeVisible();

      await contactedCard.locator("[data-renewal-drag-handle]").dragTo(page.locator("#renewal-stage-LOST"));
      await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar renovación" }).click();
      await expectMutationSuccessToast(page, "no renovada");
      await expect(page.locator("#renewal-stage-LOST li").filter({ hasText: fixture.policyNumber })).toBeVisible();
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("schedules, reschedules, and clears a manual renewal follow-up from its Operations row", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("RENEWAL-MANUAL-FOLLOWUP");
    const manualSourceId = `policy:${fixture.policyId}:renewal-manual-followup`;
    const automaticSourceId = `policy:${fixture.policyId}:renewal-followup`;
    const automaticDueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    try {
      await db.policy.update({ where: { id: fixture.policyId }, data: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) } });
      const automaticReminder = await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: automaticSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Renovación: ${fixture.policyNumber}`,
          entityType: "POLICY",
          entityId: fixture.policyId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          startDate: new Date(),
          dueDate: automaticDueDate,
        },
        select: { id: true },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=renewal-board");

      const card = page.locator("li").filter({ hasText: fixture.policyNumber }).first();
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` }).click();
      const scheduledDate = businessDateAfter(3);
      await page.getByRole("menuitem", { name: "En 3 días", exact: true }).click();
      await expectMutationSuccessToast(page, "Seguimiento programado.");

      const scheduledItem = await db.workItem.findUniqueOrThrow({
        where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId: manualSourceId } },
        select: { id: true, status: true, dueDate: true, notes: true, policyId: true },
      });
      const manualWorkItemId = scheduledItem.id;
      expect({ status: scheduledItem.status, dueDate: businessDateKey(scheduledItem.dueDate!), notes: scheduledItem.notes, policyId: scheduledItem.policyId })
        .toEqual({ status: "OPEN", dueDate: scheduledDate, notes: null, policyId: fixture.policyId });

      await page.goto("/operations?view=pending");
      const rowFollowUpMenu = page.getByRole("button", { name: `Seguimiento de ${fixture.policyNumber}` });
      await expect(rowFollowUpMenu).toBeVisible();
      await rowFollowUpMenu.click();
      await page.getByRole("menuitem", { name: "Otra fecha", exact: true }).click();
      const rescheduledDate = businessDateAfter(5);
      await page.getByLabel("Fecha de seguimiento").fill(rescheduledDate);
      await page.getByLabel("Nota opcional").fill("Llamar después de la junta");
      await page.getByRole("button", { name: "Guardar seguimiento", exact: true }).click();
      await expectMutationSuccessToast(page, "Seguimiento reprogramado.");

      await expect.poll(async () => {
        const item = await db.workItem.findUnique({ where: { id: manualWorkItemId }, select: { id: true, status: true, dueDate: true, notes: true, policyId: true } });
        return item && { id: item.id, status: item.status, dueDate: businessDateKey(item.dueDate!), notes: item.notes, policyId: item.policyId };
      }, { timeout: 10_000 }).toEqual({ id: manualWorkItemId, status: "OPEN", dueDate: rescheduledDate, notes: "Llamar después de la junta", policyId: fixture.policyId });

      await rowFollowUpMenu.click();
      await page.getByRole("menuitem", { name: "Quitar seguimiento", exact: true }).click();
      const confirmDialog = page.getByRole("alertdialog").filter({ hasText: `Quitar seguimiento de ${fixture.policyNumber}` });
      await confirmDialog.getByRole("button", { name: "Quitar seguimiento", exact: true }).click();
      await expectMutationSuccessToast(page, "Seguimiento eliminado.");
      await expect.poll(async () => {
        const [manual, automatic] = await Promise.all([
          db.workItem.findUnique({ where: { id: manualWorkItemId }, select: { id: true, status: true, dueDate: true, notes: true } }),
          db.workItem.findUnique({ where: { id: automaticReminder.id }, select: { id: true, status: true } }),
        ]);
        return { manual: manual && { id: manual.id, status: manual.status, dueDate: businessDateKey(manual.dueDate!), notes: manual.notes }, automatic };
      }, { timeout: 10_000 }).toEqual({
        manual: { id: manualWorkItemId, status: "CANCELLED", dueDate: rescheduledDate, notes: "Llamar después de la junta" },
        automatic: { id: automaticReminder.id, status: "OPEN" },
      });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("keeps open claims visible in the Operations all view", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-ALL-CLAIM");
    const folio = `E2E-OPS-CLAIM-${Date.now()}`;
    let claimId: string | null = null;

    try {
      const claim = await db.claim.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          folio,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          claimType: "AUTO",
          status: "OPEN",
          incidentDate: new Date(),
          reportedDate: new Date(),
        },
        select: { id: true },
      });
      claimId = claim.id;

      await authenticatePageAsAdmin(page);
      await page.goto("/operations");
      const openClaimsSummary = page.getByRole("link", { name: /Siniestros abiertos\s+\d+/ });
      await expect(openClaimsSummary).toBeVisible();
      await openClaimsSummary.click();
      await expect(page).toHaveURL(/\/operations\?view=claims/);
      await expect(page.getByText(folio)).toBeVisible();
    } finally {
      if (claimId) await db.claim.deleteMany({ where: { id: claimId } });
      await cleanupPolicyFixture(fixture);
    }
  });

  test("limits an agent's renewal board and policy access to the agent portfolio", async ({ page }) => {
    const db = getTestDb();
    const ownFixture = await seedPolicyFixture("OPERATIONS-AGENT-OWN");
    const otherFixture = await seedPolicyFixture("OPERATIONS-AGENT-OTHER");

    try {
      const agent = await db.user.findUniqueOrThrow({ where: { email: "ci-agent@policydesk.local" }, select: { id: true } });
      await Promise.all([
        db.client.update({ where: { id: ownFixture.clientId }, data: { portfolioOwnerId: agent.id } }),
        db.policy.update({ where: { id: ownFixture.policyId }, data: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) } }),
        db.policy.update({ where: { id: otherFixture.policyId }, data: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) } }),
      ]);

      await authenticatePageAsAgent(page);
      await page.goto("/operations?view=renewal-board");
      await expect(page.getByText(ownFixture.policyNumber, { exact: true })).toBeVisible();
      await expect(page.getByText(otherFixture.policyNumber, { exact: true })).toHaveCount(0);

      await page.goto(`/policies/${otherFixture.policyId}`);
      await expect(page.locator("body")).not.toContainText(otherFixture.policyNumber);
      await page.goto(`/policies/${otherFixture.policyId}/edit`);
      await expect(page.locator("body")).not.toContainText(otherFixture.policyNumber);
    } finally {
      await cleanupPolicyFixture(ownFixture);
      await cleanupPolicyFixture(otherFixture);
    }
  });

  test("edits and cancels an ordinary WorkItem from Operations without changing its identity", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-EDIT-WORKITEM");
    const sourceId = `e2e-ordinary-work-item-${Date.now()}`;
    const title = `Pendiente ordinario ${Date.now()}`;

    try {
      const created = await db.workItem.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "WorkItem",
          sourceId,
          workItemType: "TASK",
          taskType: "GENERAL",
          status: "OPEN",
          priority: "MEDIUM",
          title,
          startDate: new Date(),
          entityType: "WorkItem",
          entityId: sourceId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      });

      await authenticatePageAsAdmin(page);
      await page.goto("/operations?view=pending");
      await expect(page.getByRole("link", { name: `Editar pendiente: ${title}` })).toBeVisible();
      await page.goto(`/tasks/${sourceId}/edit?returnTo=${encodeURIComponent("/operations?view=pending")}`, { waitUntil: "load" });
      await expect(page).toHaveURL(new RegExp(`/tasks/${sourceId}/edit(?:\\?.*)?$`));
      await expect(page.getByText("Edición de pendiente", { exact: true })).toBeVisible();
      const priorityControl = page.locator('[aria-label="Prioridad"]');
      await priorityControl.click();
      await page.getByRole("option", { name: "Alta", exact: true }).click();
      const statusControl = page.locator('[aria-label="Estado"]');
      await expect(statusControl).toBeVisible();
      await statusControl.click();
      await page.getByRole("option", { name: "Cancelado", exact: true }).click();
      const action = await captureServerAction(page, () => page.getByRole("button", { name: "Guardar cambios", exact: true }).click());
      console.log("WorkItem update server action:", action);

      await expect.poll(async () => {
        const item = await db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "WorkItem", sourceId } } });
        return item ? { id: item.id, organizationId: item.organizationId, status: item.status, sourceType: item.sourceType, sourceId: item.sourceId, priority: item.priority, title: item.title } : null;
      }, { timeout: 10_000 }).toEqual({ id: created.id, organizationId: TEST_ORGANIZATION_ID, status: "CANCELLED", sourceType: "WorkItem", sourceId, priority: "HIGH", title });
      await expect(db.workItem.count({ where: { organizationId: TEST_ORGANIZATION_ID, sourceType: "WorkItem", sourceId } })).resolves.toBe(1);
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("an agent cannot open or edit an ordinary WorkItem outside their portfolio", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("OPERATIONS-AGENT-WORKITEM-SCOPE");
    const sourceId = `e2e-agent-denied-work-item-${Date.now()}`;
    const title = `Pendiente fuera de cartera ${Date.now()}`;

    try {
      const workItem = await db.workItem.create({
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
        },
        select: { id: true },
      });

      await authenticatePageAsAgent(page);
      await page.goto(`/tasks/${sourceId}/edit`);
      await expect(page.getByText("Edición de pendiente", { exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(title);
      await page.goto("/operations?view=pending");
      await expect(page.getByRole("link", { name: `Editar pendiente: ${title}` })).toHaveCount(0);

      await expect.poll(async () => {
        const current = await db.workItem.findUnique({ where: { id: workItem.id }, select: { id: true, organizationId: true, status: true, title: true } });
        return current;
      }).toEqual({ id: workItem.id, organizationId: TEST_ORGANIZATION_ID, status: "OPEN", title });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});
