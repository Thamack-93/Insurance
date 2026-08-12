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
