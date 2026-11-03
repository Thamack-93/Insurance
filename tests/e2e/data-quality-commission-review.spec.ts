import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../helpers/db";

const ORGANIZATION_ID = "org_legacy_singleton_0001";

test.describe("Data Quality commission review action center", () => {
  test("prioritizes posted-payment reviews, separates unpaid receipts, groups by policy, and returns after editing", async ({ page }) => {
    const db = getTestDb();
    let fixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
    const receiptIds: string[] = [];
    const paymentIds: string[] = [];

    try {
      const seeded = await seedPolicyFixture("COMM-REVIEW-DQ");
      fixture = seeded;
      const actor = await db.user.findFirst({ where: { active: true }, select: { id: true } });
      if (!actor) test.skip(true, "No active test user found");

      const now = new Date();
      const createReceipt = async (input: { suffix: string; status: "PAID" | "PENDING" | "CANCELLED"; reason: string | null; paid: boolean; calculationStatus?: string }) => {
        const receipt = await db.receipt.create({
          data: {
            organizationId: ORGANIZATION_ID,
            receiptNumber: `${input.suffix}-${Date.now().toString(36)}`,
            policyId: seeded.policyId,
            clientId: seeded.clientId,
            insurerId: seeded.insurerId,
            periodStartDate: now,
            periodEndDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            dueDate: now,
            amount: 1000,
            currency: input.suffix === "COMM-USD" ? "USD" : "MXN",
            status: input.status,
            commissionCalculationStatus: input.calculationStatus ?? "REVIEW",
            commissionReviewReason: input.reason,
            paidDate: input.paid ? now : null,
          },
        });
        receiptIds.push(receipt.id);
        if (input.paid) {
          const payment = await db.payment.create({
            data: {
              organizationId: ORGANIZATION_ID,
              receiptId: receipt.id,
              policyId: seeded.policyId,
              clientId: seeded.clientId,
              amount: 1000,
              currency: receipt.currency,
              status: "POSTED",
              paidDate: now,
              paymentMethod: "TRANSFER",
              createdById: actor!.id,
              updatedById: actor!.id,
            },
          });
          paymentIds.push(payment.id);
        }
        return receipt;
      };

      const paidReceipt = await createReceipt({ suffix: "COMM-MXN", status: "PAID", reason: "El desglose de prima por unidad está incompleto o no concilia con el importe del recibo.", paid: true });
      const cancelledPaidReceipt = await createReceipt({ suffix: "COMM-USD", status: "CANCELLED", reason: "No hay una regla de comisión exacta.", paid: true });
      const calculatedReceipt = await createReceipt({ suffix: "COMM-CALCULATED", status: "PAID", reason: null, paid: true, calculationStatus: "CALCULATED" });
      const pendingReceipt = await createReceipt({ suffix: "COMM-PENDING", status: "PENDING", reason: "Falta desglose.", paid: false });
      const cancelledReceipt = await createReceipt({ suffix: "COMM-CANCELLED", status: "CANCELLED", reason: "Falta desglose.", paid: false });
      await db.commission.create({
        data: {
          organizationId: ORGANIZATION_ID,
          policyId: seeded.policyId,
          receiptId: calculatedReceipt.id,
          clientId: seeded.clientId,
          insurerId: seeded.insurerId,
          expectedAmount: 100,
          percentage: 10,
          expectedDate: now,
          status: "PENDING",
          calculationBreakdownJson: JSON.stringify({
            calculatedAt: now.toISOString(),
            ruleVersion: 1,
            breakdown: [{ assetId: null, description: "Póliza", netPremium: 1000, expectedAmount: 100, ruleId: "synthetic-rule", ruleEvidence: "Synthetic E2E rule" }],
          }),
        },
      });

      await authenticatePageAsAdmin(page);
      await page.goto(`/data-quality?tab=revisiones&q=${encodeURIComponent(seeded.policyNumber)}`);

      await expect(page.getByText(/^Revisión de comisiones \(/)).toBeVisible();
      await expect(page.getByText("Con pago POSTED", { exact: true }).locator("..")).toContainText("2");
      await expect(page.getByText("Pendientes sin pago", { exact: true }).locator("..")).toContainText("1");
      await expect(page.getByText("Cancelados sin pago", { exact: true }).locator("..")).toContainText("1");

      const groupRow = page.locator("tr").filter({ hasText: seeded.policyNumber }).filter({ hasText: "Comisiones" });
      await expect(groupRow).toContainText("2 con pago POSTED");
      await expect(groupRow).toContainText(paidReceipt.receiptNumber);
      await expect(groupRow).toContainText(cancelledPaidReceipt.receiptNumber);
      await expect(groupRow).not.toContainText(calculatedReceipt.receiptNumber);
      await expect(groupRow).toContainText("MXN");
      await expect(groupRow).toContainText("USD");
      await expect(groupRow).toContainText("Cancelado");

      const breakdownLink = groupRow.getByRole("link", { name: "Completar desglose" });
      await expect(breakdownLink).toHaveAttribute("href", new RegExp(`/receipts/${paidReceipt.id}/edit\\?returnTo=`));
      await breakdownLink.click();
      await expect(page).toHaveURL(new RegExp(`/receipts/${paidReceipt.id}/edit\\?returnTo=`));
      await page.getByRole("link", { name: "Cancelar" }).click();
      await expect(page).toHaveURL(/\/data-quality\?tab=revisiones/);

      await page.goto(`/receipts/${paidReceipt.id}/edit?returnTo=${encodeURIComponent(`/data-quality?tab=revisiones&q=${seeded.policyNumber}`)}`);
      await page.getByLabel("Notas").fill("Corrección revisada en prueba sintética.");
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page).toHaveURL(new RegExp(`/data-quality\\?tab=revisiones&q=${seeded.policyNumber}`));

      const savedReceipt = await db.receipt.findUniqueOrThrow({ where: { id: paidReceipt.id }, select: { commissionCalculationStatus: true, commissionReviewReason: true } });
      expect(savedReceipt).toEqual({ commissionCalculationStatus: "REVIEW", commissionReviewReason: paidReceipt.commissionReviewReason });
      expect(await db.payment.count({ where: { id: { in: paymentIds }, status: "POSTED" } })).toBe(3);

      await page.getByText("Pendientes sin pago (1)", { exact: true }).click();
      await expect(page.getByText(pendingReceipt.receiptNumber)).toBeVisible();
      await page.getByText("Cancelados sin pago POSTED (1)", { exact: true }).click();
      await expect(page.getByText(cancelledReceipt.receiptNumber)).toBeVisible();
    } finally {
      await db.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await db.receipt.deleteMany({ where: { id: { in: receiptIds } } });
      if (fixture) await cleanupPolicyFixture(fixture);
    }
  });
});
