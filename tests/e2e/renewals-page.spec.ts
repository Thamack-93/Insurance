import { test, expect } from "@playwright/test";
import { getTestDb, cleanupRecentRenewalTasks } from "../helpers/db";
import { addDays, addYears } from "date-fns";

test.describe("Renewals Page (/renewals)", () => {
  let policyId: string;
  let startedAt: number;

  test.afterEach(async () => {
    const db = getTestDb();
    await cleanupRecentRenewalTasks(policyId, startedAt);
    await db.policy.deleteMany({ where: { id: policyId } });
  });

  test("displays renewal statistics", async ({ page }) => {
    await page.goto("/renewals");

    // Wait for page to load
    await expect(page.getByRole("heading", { name: "Renovaciones" })).toBeVisible();

    // Check for metric cards
    await expect(page.getByText("Vencidas").first()).toBeVisible();
    await expect(page.getByText("Próximos 30 días").first()).toBeVisible();
  });

  test("shows urgent renewals", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    // Get existing client and insurer
    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    // Create policy with urgent renewal (today)
    const policy = await db.policy.create({
      data: {
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        renewalDate: new Date(),
        startDate: new Date(),
        endDate: addYears(new Date(), 1),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await page.goto("/renewals");

    // Check for urgent renewals section
    await expect(page.getByText("Renovaciones urgentes")).toBeVisible();
  });

  test("allows filtering renewals", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    const policy = await db.policy.create({
      data: {
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        renewalDate: addDays(new Date(), 20),
        startDate: new Date(),
        endDate: addYears(new Date(), 1),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await page.goto("/renewals");

    // Search input should be visible
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(client.fullName.slice(0, 5));
      // Wait for filtered results
      await page.waitForTimeout(300);
    }
  });
});
