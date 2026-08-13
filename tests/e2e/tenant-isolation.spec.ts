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

test("dual membership requires an explicit organization selection", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("tenant-dual@policydesk.local");
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/organization\/select$/);
  await expect(page.getByText("PolicyDesk Legacy Organization")).toBeVisible();
  await expect(page.getByText("Pedro Alfredo Gómez Lorenzo")).toBeVisible();
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
