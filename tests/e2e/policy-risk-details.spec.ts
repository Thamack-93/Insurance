import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";
import { captureServerAction } from "../helpers/capture-server-action";

const TEST_ORGANIZATION_ID = "org_legacy_singleton_0001";

test.describe("structured policy risk details", () => {
  test("preserves ambiguous legacy insuredObject when saving an unrelated edit", async ({ page }) => {
    const db = getTestDb();
    const fixture = await seedPolicyFixture("POLICY-RISK-LEGACY-TEXT");
    const raw = "Unidad comercial descrita en póliza histórica sin formato confiable";

    try {
      await db.policy.update({
        where: { id: fixture.policyId },
        data: { insuredObject: raw, riskDetails: undefined, riskDetailsReviewRequired: true },
      });

      await authenticatePageAsAdmin(page);
      await page.goto(`/policies/${fixture.policyId}/edit`);
      await expect(page.locator("#insuredObject")).toHaveValue(raw);
      await page.getByLabel("Notas", { exact: true }).fill("Cambio ajeno a la descripción histórica");
      const action = await captureServerAction(page, () => page.getByRole("button", { name: "Guardar cambios", exact: true }).click());
      console.log("Policy legacy edit server action:", action);
      await expect.poll(async () => {
        const policy = await db.policy.findUnique({ where: { id: fixture.policyId }, select: { insuredObject: true, notes: true } });
        return policy ? { insuredObject: policy.insuredObject, notes: policy.notes } : null;
      }, { timeout: 10_000 }).toEqual({ insuredObject: raw, notes: "Cambio ajeno a la descripción histórica" });
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
});
