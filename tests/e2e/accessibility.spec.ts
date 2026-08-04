import { expect, test } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "../helpers/axe";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

test.describe("Critical accessibility surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await authenticatePageAsAdmin(page);
  });

  test("audits the authenticated shell and Today", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: /Buen día|Buenas tardes|Buenas noches/ })).toBeVisible();

    await expectNoSeriousAxeViolations(page);
  });

  test("audits the Nora contextual panel", async ({ page }) => {
    await page.goto("/today");
    await page.getByRole("button", { name: "Abrir Nora" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
  });

  test("audits receipts and an authorized policy detail", async ({ page }) => {
    const fixture = await seedPolicyFixture("ACCESSIBILITY");
    try {
      await page.goto("/receipts");
      await expect(page.getByRole("heading", { name: "Recibos y pagos", exact: true })).toBeVisible();
      await expectNoSeriousAxeViolations(page, "main");

      const policy = await getTestDb().policy.findUnique({
        where: { id: fixture.policyId },
        select: { id: true },
      });
      expect(policy).not.toBeNull();

      await page.goto(`/policies/${policy!.id}`);
      await expect(page.getByRole("heading", { name: fixture.policyNumber, exact: true })).toBeVisible();
      await expectNoSeriousAxeViolations(page, "main");
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});

test("audits the public PolicyDesk login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Acceso a tu centro operativo" })).toBeVisible();
  await expectNoSeriousAxeViolations(page, "main");
});
