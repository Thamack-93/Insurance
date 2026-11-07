import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

test.describe("renewal source review", () => {
  test("shows a live review, invalidates confirmation on changes and blocks incompatible terms", async ({ page }) => {
    const fixture = await seedPolicyFixture("RENEWAL-DRAFT-REVIEW");
    try {
      await getTestDb().policy.update({
        where: { id: fixture.policyId },
        data: {
          riskDetails: {
            version: 1,
            policyType: "AUTO",
            data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2022", version: "", vin: "TESTVIN001", plates: "", unitClass: "" }] },
          },
        },
      });
      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/new?renewalFrom=${fixture.policyId}`);

      await expect(page.getByRole("heading", { name: "Revisar renovación antes de guardar" })).toBeVisible();
      await expect(page.getByText(fixture.policyNumber, { exact: false }).first()).toBeVisible();

      const acknowledgement = page.getByRole("checkbox", { name: /Confirmo que revisé la póliza de origen/ });
      await expect(acknowledgement).toBeEnabled();
      await acknowledgement.check();
      await expect(acknowledgement).toBeChecked();

      await page.locator("#premiumAmount").fill("2345.67");
      await expect(acknowledgement).not.toBeChecked();
      await expect(page.getByText("Cambios detectados", { exact: false })).toBeVisible();

      await page.locator("#startDate").fill("2020-01-01");
      await expect(page.getByText(/La nueva vigencia debe ser posterior/)).toBeVisible();
      await expect(acknowledgement).toBeDisabled();
      expect(await getTestDb().policy.count({ where: { renewedFromPolicyId: fixture.policyId } })).toBe(0);
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });
});
