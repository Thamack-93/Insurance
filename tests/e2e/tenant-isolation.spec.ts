import { expect, test } from "@playwright/test";

const enabled = process.env.TENANT_ISOLATION_E2E === "1";
test.skip(!enabled, "Tenant isolation E2E requires the protected disposable fixture.");

test("tenant admin cannot open a different organization's client", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/clients/tenant-client-a");
  await expect(page.getByText("Overlap Client").first()).toBeVisible();
  await page.goto("/clients/tenant-client-b");
  await expect(page.getByText("Overlap Client").first()).not.toBeVisible();
});

test("separate browser contexts remain isolated in organizations A and B", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    await Promise.all([
      (async () => {
        await pageA.goto("/login");
        await pageA.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
        await pageA.getByLabel("Contraseña").fill("tenant-fixture-password");
        await pageA.getByRole("button", { name: "Iniciar sesión" }).click();
      })(),
      (async () => {
        await pageB.goto("/login");
        await pageB.getByLabel("Correo electrónico").fill("tenant-admin-b@policydesk.local");
        await pageB.getByLabel("Contraseña").fill("tenant-fixture-password");
        await pageB.getByRole("button", { name: "Iniciar sesión" }).click();
      })(),
    ]);
    await Promise.all([expect(pageA).toHaveURL(/\/today$/), expect(pageB).toHaveURL(/\/today$/)]);
    await Promise.all([pageA.goto("/clients/tenant-client-a"), pageB.goto("/clients/tenant-client-b")]);
    await Promise.all([
      expect(pageA.getByText("Overlap Client").first()).toBeVisible(),
      expect(pageB.getByText("Overlap Client").first()).toBeVisible(),
    ]);
    await Promise.all([pageA.goto("/clients/tenant-client-b"), pageB.goto("/clients/tenant-client-a")]);
    await Promise.all([
      expect(pageA.getByText("Overlap Client").first()).not.toBeVisible(),
      expect(pageB.getByText("Overlap Client").first()).not.toBeVisible(),
    ]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("superadmin without membership is confined to the platform shell", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-superadmin@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/platform$/);
});

test("superadmin can inspect both organizations without operational bypass", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-superadmin@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { name: "Panel master" })).toBeVisible();
  await expect(page.getByText("PolicyDesk Legacy Organization")).toBeVisible();
  await expect(page.getByText("Pedro Alfredo Gómez Lorenzo")).toBeVisible();
  await expect(page.getByText("PolicyDesk Demo Broker")).toBeVisible();
  await page.getByRole("link", { name: /Pedro Alfredo Gómez Lorenzo/ }).click();
  await expect(page).toHaveURL(/\/platform\/organizations\/org_pedro_gomez_0001$/);
  await expect(page.getByRole("heading", { name: "Pedro Alfredo Gómez Lorenzo" })).toBeVisible();
  await expect(page.getByText("pedroagl93@gmail.com")).toBeVisible();
  await expect(page.getByText("Este detalle es de consulta.")).toBeVisible();
  const missingOrganizationResponse = await page.goto("/platform/organizations/does-not-exist");
  expect(missingOrganizationResponse?.status()).toBe(404);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/platform$/);
});

test("tenant users cannot open the master panel by URL", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/today$/);
});

test("tenant policy mutation route is visibly blocked while reads remain available", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/policies/new");
  await expect(page.getByText("Mutación temporalmente bloqueada")).toBeVisible();
  await page.goto("/policies/tenant-policy-a");
  await expect(page.getByText("OVERLAP-A")).toBeVisible();

  for (const endpoint of ["/api/policies/capture/confirm", "/api/policies/capture/clients"]) {
    const response = await page.request.post(endpoint, { data: {} });
    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "POLICY_TENANT_MUTATION_PENDING",
    });
  }
});

test("Pedro signs into his isolated organization and cannot see legacy clients", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("pedroagl93@gmail.com");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/clients/tenant-client-pedro");
  await expect(page.getByText("Pedro Client Private").first()).toBeVisible();
  await page.goto("/clients/tenant-client-a");
  await expect(page.getByText("Overlap Client").first()).not.toBeVisible();
});
