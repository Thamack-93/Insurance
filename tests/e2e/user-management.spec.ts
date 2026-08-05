import { expect, test } from "@playwright/test";
import {
  authenticatePageAsAdmin,
  cleanupPolicyFixture,
  getTestDb,
  hashTestPassword,
  seedPolicyFixture,
} from "../helpers/db";

test.describe("administración de usuarios", () => {
  test("elimina una cuenta inactiva y conserva su cartera operativa", async ({ page }) => {
    const db = getTestDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetEmail = `delete-target-${suffix}@policydesk.local`;
    const replacementEmail = `delete-replacement-${suffix}@policydesk.local`;
    const target = await db.user.create({
      data: { email: targetEmail, name: "Delete Target", passwordHash: hashTestPassword("delete-target-123"), role: "AGENT", active: false },
    });
    const replacement = await db.user.create({
      data: { email: replacementEmail, name: "Delete Replacement", passwordHash: hashTestPassword("delete-replacement-123"), role: "AGENT", active: true },
    });
    let fixture: Awaited<ReturnType<typeof seedPolicyFixture>> | undefined;

    try {
      fixture = await seedPolicyFixture("USER-DELETE");
      await db.client.update({ where: { id: fixture.clientId }, data: { portfolioOwnerId: target.id } });

      await authenticatePageAsAdmin(page);
      await page.goto("/settings/users");
      const row = page.getByRole("row").filter({ hasText: targetEmail });
      await expect(row).toBeVisible();
      await row.getByTitle("Eliminar usuario").click();
      await page.getByLabel("Reasignar cartera").click();
      await page.getByRole("option", { name: new RegExp(replacementEmail) }).click();
      await page.getByRole("button", { name: "Eliminar usuario", exact: true }).click();
      await expect(row).toHaveCount(0);

      await expect
        .poll(() => db.user.findUnique({ where: { id: target.id } }), { timeout: 5_000 })
        .toBeNull();
      expect((await db.client.findUnique({ where: { id: fixture.clientId } }))?.portfolioOwnerId).toBe(replacement.id);
      expect(await db.policy.findUnique({ where: { id: fixture.policyId } })).not.toBeNull();
    } finally {
      if (fixture) await cleanupPolicyFixture(fixture);
      await db.user.deleteMany({ where: { id: { in: [target.id, replacement.id] } } });
    }
  });
});
