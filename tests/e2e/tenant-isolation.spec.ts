import { expect, test } from "@playwright/test";

const enabled = process.env.TENANT_ISOLATION_E2E === "1";
test.skip(!enabled, "Tenant isolation E2E requires the protected disposable fixture.");

test("tenant admin cannot open a different organization's client", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });

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
    await Promise.all([
      expect(pageA).toHaveURL(/\/today$/, { timeout: 30_000 }),
      expect(pageB).toHaveURL(/\/today$/, { timeout: 30_000 }),
    ]);
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
  await page.getByLabel("Correo electrónico").fill("tenant-platform-admin@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  const navigation = page.getByRole("navigation", { name: "Navegación de plataforma" });
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const destination of ["Resumen", "Organizaciones", "Facturación", "Respaldos", "Integraciones"]) {
    await expect(navigation.getByRole("link", { name: destination, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Hoy", exact: true })).toHaveCount(0);
  await expect(page.getByText("Selecciona una organización para operar", { exact: true })).toHaveCount(0);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/platform$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Abrir menú de plataforma" }).click();
  const mobileNavigation = page.getByRole("navigation", { name: "Navegación de plataforma" });
  await expect(mobileNavigation.getByRole("link")).toHaveCount(6);
  await expect(mobileNavigation.getByRole("link", { name: "Mi cuenta", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("superadmin can inspect both organizations without operational bypass", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-platform-admin@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { name: "Resumen de plataforma" })).toBeVisible();
  await page.goto("/platform/organizations");
  await expect(page.locator("main").getByRole("heading", { name: "Organizaciones", exact: true })).toBeVisible();
  await expect(page.getByText("PolicyDesk Legacy Organization")).toBeVisible();
  await expect(page.getByText("Pedro Alfredo Gómez Lorenzo")).toBeVisible();
  await expect(page.getByText("PolicyDesk Demo Broker")).toBeVisible();
  await page.getByRole("link", { name: /Pedro Alfredo Gómez Lorenzo/ }).click();
  await expect(page).toHaveURL(/\/platform\/organizations\/org_pedro_gomez_0001$/);
  await expect(page.getByRole("heading", { name: "Pedro Alfredo Gómez Lorenzo" })).toBeVisible();
  await expect(page.getByText("tenant-owner-b@policydesk.local", { exact: true })).toBeVisible();
  await expect(page.getByText("Este detalle es de consulta.")).toBeVisible();
  await page.goto("/platform/organizations/does-not-exist");
  // Next.js may stream an HTTP 200 before notFound() resolves; the rendered
  // result must still be the framework's canonical 404 and disclose no tenant.
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto("/today");
  await expect(page).toHaveURL(/\/platform$/);
});

test("superadmin can open the global backup panel without triggering mutations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-platform-admin@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await page.goto("/platform/backups");
  await expect(page.locator("main").getByRole("heading", { name: "Respaldos", exact: true })).toBeVisible();
  await expect(page.getByText("Respaldos globales de plataforma")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconciliar almacenamiento" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear respaldo ahora" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("main").getByRole("heading", { name: "Respaldos", exact: true })).toBeVisible();
});

test("tenant users cannot open the master panel by URL", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("link", { name: "Organizaciones", exact: true })).toHaveCount(0);
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/today$/);
});

test("tenant policy mutation UI is enabled and capture routes validate input", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-admin-a@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/policies/new");
  await expect(page.getByRole("heading", { name: "Nueva póliza" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear póliza" })).toBeVisible();
  await page.goto("/policies/tenant-policy-a");
  await expect(page.getByText("OVERLAP-A")).toBeVisible();

  for (const endpoint of ["/api/policies/capture/confirm", "/api/policies/capture/clients"]) {
    const response = await page.request.post(endpoint, { data: {}, headers: { Origin: "http://localhost:4173" } });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  }

  const crossTenant = await page.request.post("/api/policies/capture/confirm", {
    headers: { Origin: "http://localhost:4173" },
    data: {
      draft: {
        policyNumber: "CROSS-TENANT-MUST-NOT-CREATE",
        clientName: "Overlap Client",
        clientType: "PERSON",
        insurerName: "Overlap Insurer",
        policyType: "AUTO",
        startDate: "2027-01-01",
        endDate: "2028-01-01",
        paymentFrequency: "ANNUAL",
        premiumAmount: 1000,
        currency: "MXN",
      },
      clientId: "tenant-client-b",
      insurerId: "tenant-insurer-b",
      sourcePolicyId: "tenant-policy-b",
    },
  });
  expect(crossTenant.status()).toBe(403);
  await expect(crossTenant.json()).resolves.toMatchObject({ error: "No tienes acceso a esta póliza." });
});

test("Pedro signs into his isolated organization and cannot see legacy clients", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-owner-b@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/clients/tenant-client-pedro");
  await expect(page.getByText("Pedro Client Private").first()).toBeVisible();
  await page.goto("/clients/tenant-client-a");
  await expect(page.getByText("Overlap Client").first()).not.toBeVisible();
});

test("demo broker account stays inside synthetic demo data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("demo-owner@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/clients/tenant-client-c");
  await expect(page.getByText("Overlap Client").first()).toBeVisible();
  await page.goto("/clients/tenant-client-pedro");
  await expect(page.getByText("Pedro Client Private").first()).not.toBeVisible();
});
