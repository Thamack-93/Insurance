import { expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

    const followUpRow = page.locator("tr").filter({ hasText: fileName });
    await followUpRow.getByRole("button", { name: "Crear pendiente" }).click();
    await page.getByLabel("Título", { exact: true }).fill("Confirmar recepción de documentos");
    const dueDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Etc/GMT+6",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await page.getByLabel("Fecha límite").fill(dueDate);
    await page.getByLabel(/Notas/).fill("Seguimiento originado desde el expediente.");
    await page.getByRole("button", { name: "Guardar pendiente" }).click();
    await expect(page.getByRole("status").getByText("Pendiente creado desde el documento.")).toBeVisible();
    await expect(page).toHaveURL(/\/documents$/);

    const linkedDocument = await db.document.findUniqueOrThrow({ where: { id: documentId }, select: { taskId: true, clientId: true, policyId: true } });
    expect(linkedDocument).toMatchObject({ clientId: fixture.clientId, policyId: fixture.policyId });
    expect(linkedDocument.taskId).toBeTruthy();
    const [legacyTask, workItem] = await Promise.all([
      db.task.findUniqueOrThrow({ where: { id: linkedDocument.taskId! } }),
      db.workItem.findUniqueOrThrow({ where: { organizationId_sourceType_sourceId: { organizationId: ORGANIZATION_ID, sourceType: "Task", sourceId: linkedDocument.taskId! } } }),
    ]);
    expect(legacyTask).toMatchObject({ title: "Confirmar recepción de documentos", clientId: fixture.clientId, policyId: fixture.policyId, status: "OPEN" });
    expect(workItem).toMatchObject({ title: "Confirmar recepción de documentos", clientId: fixture.clientId, policyId: fixture.policyId, assignedToId: expect.any(String), status: "OPEN" });
    expect(await readFile(documentPath)).toEqual(syntheticPdf);

    await page.getByRole("button", { name: "Seguir en Documentos" }).click();
    await followUpRow.getByRole("button", { name: "Ver pendiente" }).click();
    await page.waitForURL(new RegExp(`/tasks/${linkedDocument.taskId}$`));
    await expect(page.getByRole("heading", { name: legacyTask.folio })).toBeVisible();
    await expect(page.getByText("Confirmar recepción de documentos").first()).toBeVisible();
    await expect(page.getByRole("link", { name: fileName })).toHaveAttribute("href", `/documents?q=${encodeURIComponent(fileName)}`);
    const linkedPreview = page.waitForResponse((response) => response.url().includes(`/api/documents/${documentId}/download?inline=1`));
    await page.getByRole("button", { name: `Abrir documento ${fileName}` }).click();
    expect((await linkedPreview).status()).toBe(200);
    await page.goto("/today");
    await expect(page.getByText("Confirmar recepción de documentos", { exact: false })).toBeVisible();
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`;
      const linked = await tx.document.findUnique({ where: { id: documentId }, select: { taskId: true } });
      if (linked?.taskId) {
        await tx.activityLog.deleteMany({ where: { organizationId: ORGANIZATION_ID, entityType: "WorkItem", entityId: linked.taskId } });
        await tx.workItem.deleteMany({ where: { organizationId: ORGANIZATION_ID, sourceType: "Task", sourceId: linked.taskId } });
        await tx.document.updateMany({ where: { id: documentId, organizationId: ORGANIZATION_ID }, data: { taskId: null } });
        await tx.task.deleteMany({ where: { id: linked.taskId, organizationId: ORGANIZATION_ID } });
      }
      await tx.activityLog.deleteMany({ where: { organizationId: ORGANIZATION_ID, entityType: "Document", entityId: documentId } });
      await tx.document.deleteMany({ where: { id: documentId, organizationId: ORGANIZATION_ID } });
    });
    await rm(documentPath, { force: true });
    await cleanupPolicyFixture(fixture);
  }
});

