import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
import { captureServerAction } from "../helpers/capture-server-action";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

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

      await expect(page.locator("#risk-AUTO-vehicles-0-make")).toHaveValue("Toyota");
      await expect(page.locator("#risk-AUTO-vehicles-0-model")).toHaveValue("Corolla");
      await expect(page.locator("#risk-AUTO-vehicles-0-year")).toHaveValue("2020");
      await expect(page.locator("#risk-AUTO-vehicles-0-vin")).toHaveValue("2T1BURHE0LC123456");
      await expect(page.locator("#risk-AUTO-vehicles-0-plates")).toHaveValue("ABC-123");
    } finally {
      await cleanupPolicyFixture(fixture);
    }
  });

  test("persists structured risk details when confirming a PDF renewal capture", async ({ page }) => {
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
      const payload = {
        clientId: fixture.clientId,
        insurerId: fixture.insurerId,
        sourcePolicyId: fixture.policyId,
        draft: {
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
        },
      };

      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/${fixture.policyId}/edit`);
      const result = await page.evaluate(async (requestBody) => {
        const response = await fetch("/api/policies/capture/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        return { status: response.status, body: await response.json() as { success?: boolean; policyId?: string; error?: string } };
      }, payload);

      expect(result.status, result.body.error).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.policyId).toBeTruthy();
      capturedPolicyId = result.body.policyId ?? null;

      const [sourceAfter, renewedPolicy, assets] = await Promise.all([
        db.policy.findUnique({ where: { id: fixture.policyId }, select: { status: true } }),
        db.policy.findUnique({ where: { id: capturedPolicyId! }, select: { renewedFromPolicyId: true, insuredObject: true, riskDetails: true } }),
        db.policyInsuredAsset.findMany({ where: { organizationId: TEST_ORGANIZATION_ID, policyId: capturedPolicyId! }, select: { assetType: true, serialNumber: true } }),
      ]);
      expect(sourceAfter?.status).toBe("RENEWED");
      expect(renewedPolicy).toMatchObject({
        renewedFromPolicyId: fixture.policyId,
        insuredObject: "Toyota Corolla 2020 LE Placas ABC-123 Serie 2T1BURHE0LC123456",
        riskDetails: {
          policyType: "AUTO",
          sourceText: "Toyota, Corolla, 2020, LE",
          data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2020", version: "LE", vin, plates: "ABC-123" }] },
        },
      });
      expect(assets).toEqual([{ assetType: "AUTO", serialNumber: vin }]);
    } finally {
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
