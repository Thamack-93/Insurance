import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, authenticatePageAsAgent, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test("filters a renewal signal, links to its policy, and removes it after the renewal advances", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("INSIGHTS-RENEWAL");

  try {
    await db.policy.update({
      where: { id: fixture.policyId },
      data: { endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), renewalStage: "PENDING", renewalStageAt: null },
    });

    await authenticatePageAsAdmin(page);
    await page.goto("/reports/insights?group=renewals&page=1");

    await expect(page.getByRole("heading", { name: "Insights operativos", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Resumen de señales operativas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Renovaciones", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(fixture.clientName, { exact: true })).toBeVisible();
    await expect(page.getByText("Renovación sin iniciar", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: fixture.clientName, exact: true })).toHaveAttribute("href", `/policies/${fixture.policyId}`);

    await db.policy.update({
      where: { id: fixture.policyId },
      data: { renewalStage: "CONTACTED", renewalStageAt: new Date() },
    });
    await page.reload();

    await expect(page.getByText(fixture.clientName, { exact: true })).toHaveCount(0);
    await expect(page.getByText("No hay señales para este filtro.", { exact: true })).toBeVisible();
  } finally {
    await cleanupPolicyFixture(fixture);
  }
});

test("limits agent Insights to the agent's own portfolio", async ({ page }) => {
  const db = getTestDb();
  const assigned = await seedPolicyFixture("INSIGHTS-AGENT-OWN");
  const other = await seedPolicyFixture("INSIGHTS-AGENT-OTHER");
  const agent = await db.user.findUniqueOrThrow({ where: { email: "ci-agent@policydesk.local" }, select: { id: true } });

  try {
    await db.client.update({ where: { id: assigned.clientId }, data: { portfolioOwnerId: agent.id } });
    await db.policy.updateMany({
      where: { id: { in: [assigned.policyId, other.policyId] } },
      data: { endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), renewalStage: "PENDING", renewalStageAt: null },
    });

    await authenticatePageAsAgent(page);
    await page.goto("/reports/insights?group=renewals");

    await expect(page.getByText(assigned.clientName, { exact: true })).toBeVisible();
    await expect(page.getByText(other.clientName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: assigned.clientName, exact: true })).toHaveAttribute("href", `/policies/${assigned.policyId}`);
  } finally {
    await cleanupPolicyFixture(assigned);
    await cleanupPolicyFixture(other);
  }
});

test("paginates a filtered group without duplicating actionable records", async ({ page }) => {
  const db = getTestDb();
  await authenticatePageAsAdmin(page);
  const admin = await db.user.findUniqueOrThrow({ where: { email: "ci-admin@policydesk.local" }, select: { id: true } });
  const sourceIdPrefix = `insights-pagination-${Date.now()}-`;
  const workItems = await Promise.all(Array.from({ length: 26 }, (_, index) => db.workItem.create({
    data: {
      organizationId: TEST_ORGANIZATION_ID,
      sourceType: "E2E_INSIGHTS",
      sourceId: `${sourceIdPrefix}${index}`,
      workItemType: "TASK",
      status: "OPEN",
      priority: "URGENT",
      priorityRank: 100,
      title: `Insights pagination ${sourceIdPrefix}${index}`,
      entityType: "WORKITEM",
      entityId: `${sourceIdPrefix}${index}`,
      assignedToId: admin.id,
    },
    select: { id: true, title: true },
  })));

  try {
    await page.goto("/reports/insights?group=work&page=1");

    const firstPageLinks = page.getByRole("link", { name: new RegExp(`Insights pagination ${sourceIdPrefix}`) });
    await expect(firstPageLinks).toHaveCount(25);
    const firstPageTitles = await firstPageLinks.allTextContents();
    await expect(page.getByText("Página 1", { exact: false })).toBeVisible();
    await page.getByRole("navigation", { name: "Paginación de casos" }).getByRole("link", { name: "Siguiente" }).click();
    await expect(page).toHaveURL(/group=work&page=2/);

    const secondPageLinks = page.getByRole("link", { name: new RegExp(`Insights pagination ${sourceIdPrefix}`) });
    await expect(secondPageLinks).toHaveCount(1);
    await expect(page.getByText("Página 2", { exact: false })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Paginación de casos" }).getByRole("link", { name: "Anterior" })).toHaveAttribute("href", /group=work/);
    const observedTitles = [...firstPageTitles, ...(await secondPageLinks.allTextContents())];
    expect(new Set(observedTitles).size).toBe(26);
  } finally {
    await db.workItem.deleteMany({ where: { id: { in: workItems.map(({ id }) => id) } } });
  }
});

test("renders the baseline dashboard and group filters", async ({ page }) => {
  await authenticatePageAsAdmin(page);
  await page.goto("/reports/insights?group=all&page=1");

  await expect(page.getByRole("heading", { name: "Insights operativos", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Resumen de señales operativas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Casos accionables", exact: true })).toBeVisible();
  const filters = page.locator('[aria-label="Filtrar señales por grupo"]');
  for (const [group, href] of [
    ["Todo", "/reports/insights"],
    ["Renovaciones", "/reports/insights?group=renewals"],
    ["Cobranza", "/reports/insights?group=collections"],
    ["Siniestros", "/reports/insights?group=claims"],
    ["Trabajo", "/reports/insights?group=work"],
  ]) {
    await expect(filters.getByRole("link", { name: group, exact: true })).toHaveAttribute("href", href);
  }
});

test("keeps results inside the organization and agent portfolio in the protected multi-org fixture", async ({ page }) => {
  test.skip(process.env.TENANT_ISOLATION_E2E !== "1", "Requires the protected disposable multi-organization fixture.");
  const db = getTestDb();
  const policyA = await db.policy.findUniqueOrThrow({ where: { id: "tenant-policy-a" }, select: { id: true, endDate: true, renewalStage: true, renewalStageAt: true } });
  const policyB = await db.policy.findUniqueOrThrow({ where: { id: "tenant-policy-b" }, select: { id: true, endDate: true, renewalStage: true, renewalStageAt: true } });
  const portfolioOnlyClientId = `insights-admin-portfolio-${Date.now()}`;
  const portfolioOnlyPolicyId = `${portfolioOnlyClientId}-policy`;
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

  try {
    await db.policy.updateMany({
      where: { id: { in: [policyA.id, policyB.id] } },
      data: { endDate: soon, renewalStage: "PENDING", renewalStageAt: null },
    });
    const insurerA = await db.insurer.findUniqueOrThrow({ where: { id: "tenant-insurer-a" }, select: { id: true } });
    const adminClient = await db.client.create({
      data: {
        id: portfolioOnlyClientId,
        organizationId: TEST_ORGANIZATION_ID,
        fullName: "Insights Admin Portfolio Only",
        type: "PERSON",
        status: "ACTIVE",
        portfolioOwnerId: "tenant-admin-a",
      },
    });
    await db.policy.create({
      data: {
        id: portfolioOnlyPolicyId,
        organizationId: TEST_ORGANIZATION_ID,
        policyNumber: "INSIGHTS-ADMIN-ONLY",
        clientId: adminClient.id,
        insurerId: insurerA.id,
        policyType: "AUTO",
        status: "ACTIVE",
        startDate: new Date(),
        endDate: soon,
        premiumAmount: 1000,
        currency: "MXN",
        paymentFrequency: "ANNUAL",
        renewalStage: "PENDING",
      },
    });

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
    await page.getByLabel("Contraseña").fill("tenant-fixture-password");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
    await page.goto("/reports/insights?group=renewals");
    await expect(page.getByText("OVERLAP-A", { exact: false })).toBeVisible();
    await expect(page.getByText("INSIGHTS-ADMIN-ONLY", { exact: false })).toBeVisible();
    await expect(page.getByText("OVERLAP-B", { exact: false })).toHaveCount(0);

    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("tenant-agent-a@policydesk.local");
    await page.getByLabel("Contraseña").fill("tenant-fixture-password");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
    await page.goto("/reports/insights?group=renewals");
    await expect(page.getByText("OVERLAP-A", { exact: false })).toBeVisible();
    await expect(page.getByText("INSIGHTS-ADMIN-ONLY", { exact: false })).toHaveCount(0);
    await expect(page.getByText("OVERLAP-B", { exact: false })).toHaveCount(0);
  } finally {
    await db.policy.deleteMany({ where: { id: portfolioOnlyPolicyId } });
    await db.client.deleteMany({ where: { id: portfolioOnlyClientId } });
    await db.policy.update({ where: { id: policyA.id }, data: { endDate: policyA.endDate, renewalStage: policyA.renewalStage, renewalStageAt: policyA.renewalStageAt } });
    await db.policy.update({ where: { id: policyB.id }, data: { endDate: policyB.endDate, renewalStage: policyB.renewalStage, renewalStageAt: policyB.renewalStageAt } });
  }
});
