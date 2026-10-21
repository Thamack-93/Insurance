import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTestDb, authenticatePageAsAdmin, seedPolicyFixture, cleanupPolicyFixture } from "../helpers/db";

const enabled = process.env.TENANT_ISOLATION_E2E === "1"
  && process.env.TENANT_ISOLATION_TEST_DB === "1"
  && process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB === "1";
const ORGANIZATION_ID = "org_legacy_singleton_0001";
test.skip(!enabled, "Document inbox E2E requires the guarded disposable local tenant fixture.");

test("document inbox previews a synthetic PDF and requires operator classification and association", async ({ page }) => {
  const db = getTestDb();
  const fixture = await seedPolicyFixture("DOCUMENT-INBOX");
  const documentId = `document-inbox-${Date.now()}`;
  const fileName = `${documentId}.pdf`;
  const documentPath = path.join(process.cwd(), "data", "documents", fileName);
  const syntheticPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "ascii");

  await mkdir(path.dirname(documentPath), { recursive: true });
  await writeFile(documentPath, syntheticPdf);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`;
    const admin = await tx.user.findUniqueOrThrow({ where: { email: "ci-admin@policydesk.local" }, select: { id: true } });
    await tx.document.create({
      data: {
        id: documentId,
        organizationId: ORGANIZATION_ID,
        documentType: "OTHER",
        fileName,
        filePath: documentPath,
        mimeType: "application/pdf",
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
  });

  try {
    await authenticatePageAsAdmin(page);
    await page.goto("/documents");
    const inboxRow = page.locator("article").filter({ hasText: fileName });
    await expect(inboxRow).toBeVisible();
    await expect(inboxRow.getByText("Pendiente de clasificación y asociación")).toBeVisible();

    const previewResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/documents/${documentId}/download?inline=1`),
    );
    await inboxRow.getByRole("button", { name: `Vista previa de ${fileName}` }).click();
    expect((await previewResponse).status()).toBe(200);
    await expect(page.locator(`iframe[title="${fileName}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Cerrar" }).click();
    await expect(page.locator(`iframe[title="${fileName}"]`)).toHaveCount(0);

    await inboxRow.getByLabel("Clasificación").click();
    await page.getByRole("option", { name: "Póliza", exact: true }).click();
    await inboxRow.locator('select[name="associationRef"]').selectOption(`POLICY:${fixture.policyId}`);
    await inboxRow.getByRole("button", { name: "Confirmar asociación" }).click();

    const associatedRow = page.locator("article").filter({ hasText: fileName });
    await expect(associatedRow).toBeVisible();
    await expect(associatedRow.getByText("Póliza", { exact: false })).toBeVisible();
    await expect(associatedRow.getByText(fixture.policyNumber, { exact: false })).toBeVisible();
    await expect(associatedRow.getByRole("button", { name: "Confirmar asociación" })).toHaveCount(0);

    const savedDocument = await db.document.findUniqueOrThrow({ where: { id: documentId }, select: { documentType: true, clientId: true, policyId: true } });
    expect(savedDocument).toEqual({ documentType: "POLICY", clientId: fixture.clientId, policyId: fixture.policyId });
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`;
      await tx.activityLog.deleteMany({ where: { organizationId: ORGANIZATION_ID, entityType: "Document", entityId: documentId } });
      await tx.document.deleteMany({ where: { id: documentId, organizationId: ORGANIZATION_ID } });
    });
    await rm(documentPath, { force: true });
    await cleanupPolicyFixture(fixture);
  }
});

