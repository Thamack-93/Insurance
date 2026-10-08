import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
import { captureServerAction } from "../helpers/capture-server-action";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

function createSyntheticPdf(text: string) {
  const pdfText = text.replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 12 Tf 20 100 Td (${pdfText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

test.describe("structured policy risk details", () => {
  test("preserves ambiguous legacy insuredObject when saving an unrelated edit", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("POLICY-RISK-LEGACY-TEXT");
    const raw = "Unidad comercial descrita en póliza histórica sin formato confiable";
    const legacyAsset = {
      organizationId: TEST_ORGANIZATION_ID,
      policyId: fixture.policyId,
      assetType: "AUTO",
      description: "Unidad comercial con descripcion historica sin formato confiable",
      serialNumber: "LEGACY-VIN-001",
      isPrimary: true,
    } as const;

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { insuredObject: raw, riskDetails: undefined, riskDetailsReviewRequired: true },
      });
      await db.policyInsuredAsset.create({ data: legacyAsset });

      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/${fixture.policyId}/edit`);
      await expect(page.locator("#insuredObject")).toHaveValue(raw);
      await page.getByLabel("Notas", { exact: true }).fill("Cambio ajeno a la descripción histórica");
      await captureServerAction(page, () => page.getByRole("button", { name: "Guardar cambios", exact: true }).click());
      await expect.poll(async () => {
        const [policy, assets] = await Promise.all([
          db.policy.findUnique({ where: { id: fixture.policyId }, select: { insuredObject: true, notes: true } }),
          db.policyInsuredAsset.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } }),
        ]);
        return policy ? { insuredObject: policy.insuredObject, notes: policy.notes, assets } : null;
      }, { timeout: 10_000 }).toMatchObject({
        insuredObject: raw,
        notes: "Cambio ajeno a la descripción histórica",
        assets: [{ description: legacyAsset.description, serialNumber: legacyAsset.serialNumber, assetType: legacyAsset.assetType }],
      });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("clears stale risk relations on ramo change and keeps legacy beneficiary notes editable", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("POLICY-RISK-RELATION-SWITCH");
    const insuredObject = "Unidad móvil de archivo histórico";

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { insuredObject, beneficiaryInfo: "Nota anterior", riskDetails: undefined },
      });
      await db.policyInsuredAsset.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          policyId: fixture.policyId,
          assetType: "AUTO",
          description: "Vehículo obsoleto de la póliza anterior",
          serialNumber: "OLD-VIN-123",
          isPrimary: true,
        },
      });
      await db.policyInsuredParty.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          policyId: fixture.policyId,
          fullName: "Persona anterior",
          isPrimary: true,
          sourceLabel: "Datos históricos",
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/${fixture.policyId}/edit`);
      await page.getByRole("combobox", { name: "Tipo", exact: true }).click();
      await page.getByRole("option", { name: "GMM", exact: true }).click();
      await page.locator("#risk-GMM-insuredPeople-0-fullName").fill("Ana Pérez");
      const beneficiaryNotes = page.getByLabel("Beneficiarios / notas de beneficiarios", { exact: true });
      await expect(beneficiaryNotes).toBeEditable();
      await beneficiaryNotes.fill("Notas de beneficiario para GMM");
      const action = await captureServerAction(page, () => page.getByRole("button", { name: "Guardar cambios", exact: true }).click());
      console.log("Policy risk change server action:", action);
      await expect.poll(async () => {
        const [policy, assets, parties] = await Promise.all([
          db.policy.findUnique({ where: { id: fixture.policyId }, select: { policyType: true, insuredObject: true, beneficiaryInfo: true } }),
          db.policyInsuredAsset.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId } }),
          db.policyInsuredParty.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: fixture.policyId }, select: { fullName: true } }),
        ]);
        return policy ? { policyType: policy.policyType, insuredObject: policy.insuredObject, beneficiaryInfo: policy.beneficiaryInfo, assets: assets.length, parties: parties.map((party) => party.fullName) } : null;
      }, { timeout: 10_000 }).toEqual({
        policyType: "GMM",
        insuredObject: "Ana Pérez",
        beneficiaryInfo: "Notas de beneficiario para GMM",
        assets: 0,
        parties: ["Ana Pérez"],
      });
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("prefills structured risk details when starting a policy renewal", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("POLICY-RISK-RENEWAL-FORM");
    const renewalNumber = `${fixture.policyNumber}-RENEWAL`;
    let renewalId: string | null = null;
    const riskDetails = {
      version: 1,
      policyType: "AUTO",
      sourceText: "Toyota, Corolla, 2020, LE",
      data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2020", version: "LE", vin: "2T1BURHE0LC123456", plates: "ABC-123" }] },
    };

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { insuredObject: "Toyota Corolla 2020 LE", riskDetails },
      });
      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/new?renewalFrom=${fixture.policyId}`);

      await expect(page.getByText("Se copiaron los datos del riesgo y asegurados de la póliza anterior.")).toBeVisible();
      await expect(page.locator("#risk-AUTO-vehicles-0-make")).toHaveValue("Toyota");
      await expect(page.locator("#risk-AUTO-vehicles-0-model")).toHaveValue("Corolla");
      await expect(page.locator("#risk-AUTO-vehicles-0-year")).toHaveValue("2020");
      await expect(page.locator("#risk-AUTO-vehicles-0-vin")).toHaveValue("2T1BURHE0LC123456");
      await expect(page.locator("#risk-AUTO-vehicles-0-plates")).toHaveValue("ABC-123");
      await page.locator("#premiumAmount").fill("1500");
      await page.locator("#risk-AUTO-vehicles-0-make").fill("Honda");

      await page.locator("#policyNumber").fill(renewalNumber);
      await page.getByRole("button", { name: "Crear póliza", exact: true }).click();
      await expect(page).toHaveURL(/\/policies\/[^/]+$/);
      renewalId = new URL(page.url()).pathname.split("/").pop() ?? null;
      const comparison = page.getByRole("region", { name: "Comparación con póliza anterior" });
      await expect(comparison).toBeVisible();
      const makeChange = comparison.locator("li").filter({ hasText: "Marca" });
      await expect(makeChange).toContainText("Toyota");
      await expect(makeChange).toContainText("Honda");
      await expect(makeChange).toContainText("Cambió");
      await expect(comparison).toContainText("Diferencia de prima:");
      await expect(comparison).toContainText("+21.5%");
      const sourceAfter = await db.policy.findUniqueOrThrow({ where: { id: fixture.policyId }, select: { premiumAmount: true, riskDetails: true, insuredObject: true, status: true } });
      expect(Number(sourceAfter.premiumAmount)).toBe(1234.56);
      expect(sourceAfter).toMatchObject({
        status: "RENEWED",
        insuredObject: "Toyota Corolla 2020 LE",
        riskDetails: {
          policyType: "AUTO",
          data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2020", version: "LE", vin: "2T1BURHE0LC123456", plates: "ABC-123" }] },
        },
      });
    } finally {
      if (renewalId) {
        await db.activityLog.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, entityType: "Policy", entityId: renewalId } });
        await db.payment.deleteMany({ where: { policyId: renewalId } });
        await db.commission.deleteMany({ where: { policyId: renewalId } });
        await db.receipt.deleteMany({ where: { policyId: renewalId } });
        await db.workItem.deleteMany({ where: { policyId: renewalId } });
        await db.policyInsuredParty.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: renewalId } });
        await db.policyInsuredAsset.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: renewalId } });
        await db.policy.deleteMany({ where: { id: renewalId } });
      }
      await cleanupPolicyFixture(fixture);
    }
  });

  test("persists edited structured risk details through the PDF capture UI", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("POLICY-RISK-PDF-CONFIRM");
    const vin = "2T1BURHE0LC123456";
    let capturedPolicyId: string | null = null;

    try {
      const source = await db.policy.findUniqueOrThrow({
        where: { id: fixture.policyId },
        select: { policyNumber: true, startDate: true, endDate: true },
      });
      const renewalStartDate = source.endDate.toISOString().slice(0, 10);
      const renewalEnd = new Date(source.endDate);
      renewalEnd.setUTCFullYear(renewalEnd.getUTCFullYear() + 1);
      const renewalEndDate = renewalEnd.toISOString().slice(0, 10);
      const riskDetails = {
        version: 1,
        policyType: "AUTO",
        sourceText: "Toyota, Corolla, 2020, LE",
        data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2020", version: "LE", vin, plates: "ABC-123" }] },
      };
      await db.policy.update({ where: { id: fixture.policyId }, data: { riskDetails, insuredObject: "Toyota Corolla 2020 LE Placas ABC-123 Serie 2T1BURHE0LC123456" } });
      const draft = {
        policyNumber: `${fixture.policyNumber}-REN`,
        clientName: fixture.clientName,
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        clientBirthDate: null,
        insurerName: fixture.insurerName,
        policyType: "AUTO",
        startDate: renewalStartDate,
        endDate: renewalEndDate,
        issueDate: null,
        paymentFrequency: "ANNUAL",
        paymentPlan: null,
        premiumAmount: 1234.56,
        currency: "MXN",
        requestNumber: "CAPTURE-TEST",
        insuredObject: "Toyota Corolla 2020 LE",
        riskDetails,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: source.policyNumber,
        serialNumber: vin,
      };

      await authenticatePageAsAdmin(page);
      await page.route("**/api/nora/policy-pdf/analyze", async (route) => {
        const request = route.request().postDataJSON() as { text?: string };
        expect(request.text).toContain("SYNTHETIC POLICY DOCUMENT");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            preview: {
              draft,
              suggestions: { clientId: fixture.clientId, insurerId: fixture.insurerId, sourcePolicyId: fixture.policyId },
              receiptPlan: [],
              clientOptions: [],
              insurerOptions: [],
              sourcePolicyOptions: [],
              fieldConfidence: {
                policyNumber: "high", clientName: "high", clientType: "high", clientEmail: "high", clientPhone: "high",
                clientAddress: "high", clientRfc: "high", clientBirthDate: "high", insurerName: "high", policyType: "high",
                serialNumber: "high", startDate: "high", endDate: "high", issueDate: "high", paymentFrequency: "high",
                premiumAmount: "high", sourcePolicyNumber: "high",
              },
              confidence: { client: true, insurer: true, sourcePolicy: true },
              warnings: [],
              aiReview: null,
              provenance: { requestedMode: "local", extractionSource: "local", reviewSource: "none", aiRunIds: [], trackingStatus: "recorded", aiAttempted: false },
            },
            pdfReference: null,
          }),
        });
      });
      await page.goto("/policies/capture");
      await page.locator("#pdf-file").setInputFiles({
        name: "synthetic-policy.pdf",
        mimeType: "application/pdf",
        buffer: createSyntheticPdf("SYNTHETIC POLICY DOCUMENT"),
      });
      await page.getByRole("button", { name: "Analizar PDF", exact: true }).click();
      await expect(page.locator("#risk-AUTO-vehicles-0-make")).toHaveValue("Toyota");
      await page.locator("#risk-AUTO-vehicles-0-make").fill("Honda");
      await page.locator("#risk-AUTO-vehicles-0-model").fill("Civic");
      await expect(page.getByRole("button", { name: "Crear póliza y marcar como renovada" })).toBeEnabled();
      const confirmResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/policies/capture/confirm") && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Crear póliza y marcar como renovada" }).click();
      const confirmResponse = await confirmResponsePromise;
      const confirmBody = await confirmResponse.json() as { redirectTo?: string; error?: string };
      expect(confirmResponse.ok(), confirmBody.error).toBe(true);
      capturedPolicyId = confirmBody.redirectTo ? new URL(confirmBody.redirectTo, page.url()).pathname.split("/").pop() ?? null : null;
      expect(capturedPolicyId).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/policies/${capturedPolicyId}$`));

      const [sourceAfter, renewedPolicy, assets] = await Promise.all([
        db.policy.findUnique({ where: { id: fixture.policyId }, select: { status: true } }),
        db.policy.findUnique({ where: { id: capturedPolicyId! }, select: { renewedFromPolicyId: true, insuredObject: true, riskDetails: true } }),
        db.policyInsuredAsset.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: capturedPolicyId! }, select: { assetType: true, serialNumber: true } }),
      ]);
      expect(sourceAfter?.status).toBe("RENEWED");
      expect(renewedPolicy).toMatchObject({
        renewedFromPolicyId: fixture.policyId,
        insuredObject: "Honda Civic 2020 LE Placas ABC-123 Serie 2T1BURHE0LC123456",
        riskDetails: {
          policyType: "AUTO",
          sourceText: "Toyota, Corolla, 2020, LE",
          data: { vehicles: [{ make: "Honda", model: "Civic", year: "2020", version: "LE", vin, plates: "ABC-123" }] },
        },
      });
      expect(assets).toEqual([{ assetType: "AUTO", serialNumber: vin }]);
      const comparison = page.getByRole("region", { name: "Comparación con póliza anterior" });
      await expect(comparison).toBeVisible();
      await expect(comparison).toContainText("Marca");
      await expect(comparison).toContainText("Toyota");
      await expect(comparison).toContainText("Honda");
      await expect(comparison).toContainText("Cambió");
    } finally {
      const policyIds = [fixture.policyId, capturedPolicyId].filter((id): id is string => Boolean(id));
      await db.activityLog.deleteMany({
        where: { organizationId: TEST_ORGANIZATION_ID, entityType: "Policy", entityId: { in: policyIds } },
      });
      if (capturedPolicyId) {
        await db.payment.deleteMany({ where: { policyId: capturedPolicyId } });
        await db.commission.deleteMany({ where: { policyId: capturedPolicyId } });
        await db.receipt.deleteMany({ where: { policyId: capturedPolicyId } });
        await db.workItem.deleteMany({ where: { policyId: capturedPolicyId } });
        await db.policyInsuredParty.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: capturedPolicyId } });
        await db.policyInsuredAsset.deleteMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: capturedPolicyId } });
        await db.policy.deleteMany({ where: { id: capturedPolicyId } });
      }
      await cleanupPolicyFixture(fixture);
    }
  });
});
