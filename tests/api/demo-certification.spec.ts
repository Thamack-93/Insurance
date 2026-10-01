import { expect, test, type Page } from "@playwright/test";
import { assertDisposableCertificationTarget } from "../../scripts/tenant-certification-target.mjs";

test.skip(process.env.TENANT_ISOLATION_E2E !== "1", "Requires the protected disposable tenant fixture.");
test.beforeAll(() => { assertDisposableCertificationTarget(process.env.DATABASE_URL ?? ""); });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("tenant-fixture-password");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

test("CUSTOMER search, export and direct document ID stay inside its tenant", async ({ page }) => {
  await login(page, "tenant-owner-b@policydesk.local");
  const search = await page.request.get("/api/search?q=Overlap&scope=all");
  expect(search.status()).toBe(200);
  const results = JSON.stringify(await search.json());
  expect(results).toContain("tenant-client-b");
  expect(results).not.toContain("tenant-client-a");
  expect(results).not.toContain("tenant-client-c");
  const exported = await page.request.get("/api/export/clients?format=csv");
  expect(exported.status()).toBe(200);
  const content = await exported.text();
  expect(content).toContain("Pedro Client Private");
  expect(content).not.toContain("tenant-client-a");
  const foreignDocument = await page.request.get("/api/documents/org_demo_broker_0001:demo:document:001/download");
  expect(foreignDocument.status()).toBe(404);
});

test("DEMO blocks Nora and real document uploads", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "demo-owner@policydesk.local");
  await expect(page.getByLabel("Organización de demostración")).toBeVisible();
  await expect(page.getByText("Esta acción está deshabilitada en la organización de demostración.", { exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const nora = await page.request.post("/api/assistant", { data: {}, headers: { Origin: origin } });
  expect(nora.status()).toBe(403);
  const upload = await page.request.post("/api/documents/upload", {
    headers: { Origin: origin },
    multipart: { documentType: "POLICY", clientId: "tenant-client-c", file: { name: "real.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nnot a complete PDF") } },
  });
  expect(upload.status()).toBe(403);
});
