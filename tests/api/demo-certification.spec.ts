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
  const search = await page.evaluate(async () => {
    const response = await fetch("/api/search?q=Overlap&scope=all");
    return { status: response.status, body: await response.text() };
  });
  expect(search.status).toBe(200);
  const results = search.body;
  expect(results).toContain("tenant-client-b");
  expect(results).not.toContain("tenant-client-a");
  expect(results).not.toContain("tenant-client-c");
  const exported = await page.evaluate(async () => {
    const response = await fetch("/api/export/clients?format=csv");
    return { status: response.status, body: await response.text() };
  });
  expect(exported.status).toBe(200);
  const content = exported.body;
  expect(content).toContain("Pedro Client Private");
  expect(content).not.toContain("tenant-client-a");
  const foreignDocument = await page.evaluate(async () => {
    const response = await fetch("/api/documents/org_demo_broker_0001:demo:document:001/download");
    return response.status;
  });
  expect(foreignDocument).toBe(404);
});

test("DEMO blocks Nora and real document uploads", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "demo-owner@policydesk.local");
  await expect(page.getByLabel("Organización de demostración")).toBeVisible();
  await expect(page.getByText("Esta acción está deshabilitada en la organización de demostración.", { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const nora = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const form = new FormData();
    form.set("documentType", "POLICY");
    form.set("clientId", "tenant-client-c");
    form.set("file", new File(["%PDF-1.4\nnot a complete PDF"], "real.pdf", { type: "application/pdf" }));
    const upload = await fetch("/api/documents/upload", { method: "POST", body: form });
    return { nora: nora.status, upload: upload.status };
  });
  expect(result.nora).toBe(403);
  expect(result.upload).toBe(403);
});

test("DEMO search and export never expose CUSTOMER fixture records", async ({ page }) => {
  await login(page, "demo-owner@policydesk.local");
  const result = await page.evaluate(async () => {
    const searchResponse = await fetch("/api/search?q=Overlap&scope=all");
    const search = await searchResponse.text();
    const exportResponse = await fetch("/api/export/clients?format=csv");
    const exported = await exportResponse.text();
    return {
      searchStatus: searchResponse.status,
      search,
      exportStatus: exportResponse.status,
      exported,
    };
  });

  expect(result.searchStatus).toBe(200);
  expect(result.search).not.toContain("Overlap Client");
  expect(result.search).not.toContain("tenant-client-a");
  expect(result.search).not.toContain("tenant-client-b");
  expect(result.exportStatus).toBe(200);
  expect(result.exported).not.toContain("Overlap Client");
  expect(result.exported).not.toContain("tenant-client-a");
  expect(result.exported).not.toContain("tenant-client-b");
});
