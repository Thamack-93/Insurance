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
  await expect(page.getByText("Tenant Fixture A")).toBeVisible();
  await expect(page.getByText("Tenant Fixture B")).toBeVisible();
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
  await page.goto("/policies/new");
  await expect(page.getByText("Mutación temporalmente bloqueada")).toBeVisible();
  await page.goto("/policies/tenant-policy-a");
  await expect(page.getByText("OVERLAP-A")).toBeVisible();
});
