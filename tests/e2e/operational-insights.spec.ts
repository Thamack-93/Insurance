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
    await expect(page.locator('[aria-label="Filtrar señales por grupo"]').getByRole("link", { name: "Renovaciones", exact: true }))
      .toHaveAttribute("aria-current", "page");
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
