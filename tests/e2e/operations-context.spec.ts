import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, getTestDb } from "../helpers/db";

test.describe("operation queue context", () => {
  test("resolves legacy renewal context and links to the policy", async ({ page }) => {
    const db = getTestDb();
    const policy = await db.policy.findFirst({
      where: { policyNumber: "CI-POL-0001" },
      select: { id: true, clientId: true, insurerId: true, policyNumber: true },
    });
    expect(policy).not.toBeNull();

    const sourceId = `e2e-legacy-renewal-${Date.now()}`;
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

    try {
      await authenticatePageAsAdmin(page);
      await page.goto("/operations");

      const renewalLink = page.getByRole("link", { name: new RegExp(`Renovación: ${policy!.policyNumber}`) }).first();
      await expect(renewalLink).toBeVisible();
      await expect(renewalLink).toContainText("CI Client");
      await expect(renewalLink).toContainText("CI Insurer");
      await expect(renewalLink).toContainText("Vigencia");
      await expect(renewalLink).toHaveAttribute("href", `/policies/${policy!.id}`);

      await renewalLink.click();
      await expect(page).toHaveURL(new RegExp(`/policies/${policy!.id}$`));
      await expect(page.getByRole("heading", { name: policy!.policyNumber, exact: true })).toBeVisible();
    } finally {
      await db.workItem.delete({ where: { id: workItem.id } }).catch(() => undefined);
    }
  });
});
