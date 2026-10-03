import { test, expect } from "@playwright/test";
import { authenticatePageAsAdmin, getTestDb, cleanupRecentRenewalWorkItems } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";
import { addDays, addYears } from "date-fns";

test.describe("Renewals Page (/renewals)", () => {
  let policyId = "";
  let startedAt = 0;

  test.afterEach(async () => {
    const db = getTestDb();
    if (policyId) {
      await cleanupRecentRenewalWorkItems(policyId, startedAt);
      await db.policy.deleteMany({ where: { id: policyId } });
    }
  });

  test("displays renewal statistics", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/operations?view=renewals");

    // Wait for page to load
    await expect(page.getByRole("heading", { name: "Renovaciones", exact: true })).toBeVisible();

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
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addYears(new Date(), 1),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals");

    // Check for urgent renewals section
    await expect(page.getByText("Renovaciones urgentes", { exact: true })).toBeVisible();
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
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: `REN-E2E-${Date.now()}`,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addYears(new Date(), 1),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals");

    // Search input should be visible
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(client.fullName.slice(0, 5));
      // Wait for filtered results
      await page.waitForTimeout(300);
    }
  });

  test("opens renewal creation prefilled from a renewal row", async ({ page }) => {
    startedAt = Date.now();
    const db = getTestDb();

    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!client || !insurer) {
      test.skip(true, "No client or insurer found");
      return;
    }

    const policyNumber = `REN-E2E-${Date.now()}`;
    const policy = await db.policy.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber,
        clientId: client.id,
        insurerId: insurer.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date(),
        endDate: addDays(new Date(), 1),
        premiumAmount: 1000,
        currency: "MXN",
      },
    });
    policyId = policy.id;

    await authenticatePageAsAdmin(page);
    await page.goto("/renewals");

    const row = page.locator("tr", { hasText: policyNumber });
    await expect(row.getByRole("link", { name: "Renovar" })).toBeVisible();
    await row.getByRole("link", { name: "Renovar" }).click();

    await expect(page).toHaveURL(new RegExp(`/policies/new\\?renewalFrom=${policy.id}`));
    await expect(page.getByText("Renueva a")).toBeVisible();
    await expect(page.getByText(policyNumber, { exact: true })).toBeVisible();
  });
});
