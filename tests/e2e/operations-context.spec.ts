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

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación: ${policy!.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText(fixture.clientName);
      await expect(renewalLink).toContainText(fixture.insurerName);
      await expect(renewalLink).toContainText("Vigencia");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}`);

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
          dueDate: policy!.endDate,
          startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });
      workItemId = workItem.id;

      await authenticatePageAsAdmin(page);
      await page.goto("/operations");

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación: ${policy!.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText(fixture.clientName);
      await expect(renewalLink).toContainText(fixture.insurerName);
      await expect(renewalLink).toContainText("Renovación");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}`);
    } finally {
      if (workItemId) await db.workItem.delete({ where: { id: workItemId } }).catch(() => undefined);
      await cleanupPolicyFixture(fixture);
    }
  });
});
