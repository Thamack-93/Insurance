import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
import { captureServerAction } from "../helpers/capture-server-action";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test("creating a linked renewal closes both source follow-ups in the policy transaction", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("POLICY-RENEWAL-FOLLOWUP-CLOSE");
  const automaticSourceId = `policy:${fixture.policyId}:renewal-followup`;
  const manualSourceId = `policy:${fixture.policyId}:renewal-manual-followup`;
  const renewedPolicyNumber = `TEST-RENEWAL-${Date.now()}`;

  try {
    await db.workItem.createMany({
      data: [
        {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: automaticSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Recordatorio automático ${fixture.policyNumber}`,
          entityType: "Policy",
          entityId: fixture.policyId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: manualSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: `Siguiente contacto ${fixture.policyNumber}`,
          entityType: "Policy",
          entityId: fixture.policyId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      ],
    });

    await authenticatePageAsAdmin(page);
    await page.goto(`/policies/new?renewalFrom=${fixture.policyId}`);
    await page.locator("#policyNumber").fill(renewedPolicyNumber);
    const action = await captureServerAction(page, () => page.getByRole("button", { name: "Crear póliza", exact: true }).click());
    console.log("Policy renewal server action:", action);
    await expect.poll(async () => {
      const [source, automatic, manual] = await Promise.all([
        db.policy.findUnique({ where: { id: fixture.policyId }, select: { status: true } }),
        db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId: automaticSourceId } }, select: { status: true, closedDate: true } }),
        db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId: manualSourceId } }, select: { status: true, closedDate: true } }),
      ]);
      return { source: source?.status, automatic: automatic && { status: automatic.status, closed: Boolean(automatic.closedDate) }, manual: manual && { status: manual.status, closed: Boolean(manual.closedDate) } };
    }, { timeout: 10_000 }).toEqual({
      source: "RENEWED",
      automatic: { status: "RESOLVED", closed: true },
      manual: { status: "CANCELLED", closed: true },
    });
  } finally {
    const renewed = await db.policy.findFirst({ where: { organizationId: TEST_ORGANIZATION_ID, policyNumber: renewedPolicyNumber }, select: { id: true } });
    if (renewed) {
      await db.payment.deleteMany({ where: { policyId: renewed.id } });
      await db.commission.deleteMany({ where: { policyId: renewed.id } });
      await db.receipt.deleteMany({ where: { policyId: renewed.id } });
      await db.workItem.deleteMany({ where: { policyId: renewed.id } });
      await db.policy.delete({ where: { id: renewed.id } });
    }
    await cleanupPolicyFixture(fixture);
  }
});

test("a failed follow-up close rolls back linked policy creation and source renewal status", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("POLICY-RENEWAL-FOLLOWUP-ROLLBACK");
  const automaticSourceId = `policy:${fixture.policyId}:renewal-followup`;
  const manualSourceId = `policy:${fixture.policyId}:renewal-manual-followup`;
  const renewedPolicyNumber = `TEST-RENEWAL-ROLLBACK-${Date.now()}`;
  const ddlSuffix = Date.now().toString(36).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const functionName = `e2e_fail_renewal_close_${ddlSuffix}`;
  const triggerName = `e2e_fail_renewal_close_${ddlSuffix}`;
  let triggerInstalled = false;

  try {
    await db.workItem.createMany({
      data: [
        {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: automaticSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "HIGH",
          title: `Recordatorio automático ${fixture.policyNumber}`,
          entityType: "Policy",
          entityId: fixture.policyId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          organizationId: TEST_ORGANIZATION_ID,
          sourceType: "Renewal",
          sourceId: manualSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: `Siguiente contacto ${fixture.policyNumber}`,
          entityType: "Policy",
          entityId: fixture.policyId,
          clientId: fixture.clientId,
          policyId: fixture.policyId,
          insurerId: fixture.insurerId,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      ],
    });

    await db.$executeRawUnsafe(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceId" = '${automaticSourceId}' AND NEW."status" <> OLD."status" THEN RAISE EXCEPTION 'E2E_RENEWAL_FOLLOWUP_CLOSE_FAILED'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "WorkItem" FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
    triggerInstalled = true;

    await authenticatePageAsAdmin(page);
    await page.goto(`/policies/new?renewalFrom=${fixture.policyId}`);
    await page.locator("#policyNumber").fill(renewedPolicyNumber);
    const action = await captureServerAction(page, () => page.getByRole("button", { name: "Crear póliza", exact: true }).click());
    expect(action.status).toBeLessThan(500);
    await expect(page.getByText("E2E_RENEWAL_FOLLOWUP_CLOSE_FAILED")).toBeVisible();

    await expect.poll(async () => {
      const [source, renewed, automatic, manual] = await Promise.all([
        db.policy.findUnique({ where: { id: fixture.policyId }, select: { status: true } }),
        db.policy.findFirst({ where: { organizationId: TEST_ORGANIZATION_ID, policyNumber: renewedPolicyNumber }, select: { id: true } }),
        db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId: automaticSourceId } }, select: { status: true } }),
        db.workItem.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: TEST_ORGANIZATION_ID, sourceType: "Renewal", sourceId: manualSourceId } }, select: { status: true } }),
      ]);
      return { source: source?.status, renewed: renewed?.id ?? null, automatic: automatic?.status, manual: manual?.status };
    }, { timeout: 10_000 }).toEqual({ source: "ACTIVE", renewed: null, automatic: "OPEN", manual: "OPEN" });
  } finally {
    if (triggerInstalled) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "WorkItem"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
    } else {
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
    }
    const renewed = await db.policy.findFirst({ where: { organizationId: TEST_ORGANIZATION_ID, policyNumber: renewedPolicyNumber }, select: { id: true } });
    if (renewed) {
      await db.payment.deleteMany({ where: { policyId: renewed.id } });
      await db.commission.deleteMany({ where: { policyId: renewed.id } });
      await db.receipt.deleteMany({ where: { policyId: renewed.id } });
      await db.workItem.deleteMany({ where: { policyId: renewed.id } });
      await db.policy.delete({ where: { id: renewed.id } });
    }
    await cleanupPolicyFixture(fixture);
  }
});
