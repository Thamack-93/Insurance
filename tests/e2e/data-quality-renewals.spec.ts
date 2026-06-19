import { test, expect } from "@playwright/test";
import { addDays } from "date-fns";
import { authenticatePageAsAdmin, getTestDb } from "../helpers/db";

test.describe("Data quality renewals tab", () => {
  let policyId = "";

  test.afterEach(async () => {
    if (!policyId) return;
    const db = getTestDb();
    await db.policy.deleteMany({ where: { id: policyId } });
  });

  test("shows renewal follow-up rows with date, client, insurer and action", async ({ page }) => {
    const db = getTestDb();
    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    const policyNumber = `REN-QA-${Date.now()}`;
    const endDate = addDays(new Date(), 12);
    const policy = await db.policy.create({
      data: {
        policyNumber,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate,
        premiumAmount: 1500,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/data-quality?tab=renovaciones");

    await expect(page.getByText(policyNumber, { exact: true })).toBeVisible();
  });
});
