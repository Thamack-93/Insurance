import { expect, test } from "@playwright/test";
import {
  authenticatePageAsAdmin,
  cleanupSeededReceipt,
  getTestDb,
  seedPendingReceipt,
  type SeededReceipt,
} from "../helpers/db";

const ORGANIZATION_ID = "org_legacy_singleton_0001";
const PREMIUM_REVIEW_REASON = "PNP derivada del desglose por unidad; validar contra el recibo individual antes de aprobar.";

type BonusFixture = {
  runId: string;
  ruleSetId: string;
  receipt: SeededReceipt;
  paymentId: string | null;
};

async function createBonusFixture(input: {
  year: number;
  status: "READY" | "REVIEW";
  itemStatus?: "INCLUDED" | "REVIEW";
  itemReason?: string;
  empty?: boolean;
  includePayment?: boolean;
}): Promise<BonusFixture> {
  const db = getTestDb();
  const receipt = await seedPendingReceipt("BONUS-E2E");
  const admin = await db.user.findUniqueOrThrow({ where: { email: "ci-admin@policydesk.local" }, select: { id: true, name: true } });
  const latestRuleSet = await db.bonusRuleSet.findFirst({
    where: { organizationId: ORGANIZATION_ID, programKey: "AUTO_2026" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const ruleSet = await db.bonusRuleSet.create({
    data: {
      organizationId: ORGANIZATION_ID,
      programKey: "AUTO_2026",
      version: (latestRuleSet?.version ?? 0) + 1,
      effectiveStart: new Date("2000-01-01T00:00:00.000Z"),
      effectiveEnd: new Date("2099-12-31T23:59:59.999Z"),
      sourceFileName: "Synthetic bonus E2E fixture",
      sourceHash: `bonus-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rulesJson: JSON.stringify({ syntheticFixture: true }),
      createdById: admin.id,
    },
  });

  let paymentId: string | null = null;
  if (input.includePayment) {
    const payment = await db.payment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        receiptId: receipt.id,
        policyId: receipt.policyId,
        clientId: receipt.clientId,
        amount: 1234.56,
        currency: "MXN",
        status: "POSTED",
        paidDate: new Date("2000-01-15T00:00:00.000Z"),
        paymentMethod: "TRANSFER",
        createdById: admin.id,
        updatedById: admin.id,
      },
      select: { id: true },
    });
    paymentId = payment.id;
  }

  const item = input.empty ? undefined : {
    organizationId: ORGANIZATION_ID,
    paymentId,
    receiptId: receipt.id,
    policyId: receipt.policyId,
    status: input.itemStatus ?? "REVIEW",
    currency: "MXN",
    paidAmount: 1234.56,
    netPremiumPaid: 1000,
    eligibleAmount: 1000,
    reason: input.itemReason ?? "Revisar evidencia de prueba.",
    evidenceJson: JSON.stringify({ source: "synthetic e2e" }),
  };

  const run = await db.bonusRun.create({
    data: {
      organizationId: ORGANIZATION_ID,
      ruleSetId: ruleSet.id,
      programKey: "AUTO_2026",
      sellerId: admin.id,
      year: input.year,
      periodType: "ANNUAL",
      periodNumber: 1,
      status: input.status,
      baseAmount: 0,
      bonusRate: 0,
      bonusAmount: 0,
      snapshotJson: JSON.stringify({
        input: {},
        programKey: "AUTO_2026",
        projection: { status: input.status, reviewReasons: [], items: [] },
        ruleSetId: ruleSet.id,
        sourceHash: ruleSet.sourceHash,
      }),
      reviewReasonsJson: JSON.stringify([]),
      version: 1,
      createdById: admin.id,
      ...(item ? { items: { create: item } } : {}),
    },
    select: { id: true },
  });

  return { runId: run.id, ruleSetId: ruleSet.id, receipt, paymentId };
}

async function cleanupBonusFixture(fixture: BonusFixture) {
  const db = getTestDb();
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`;
    await tx.bonusRun.deleteMany({ where: { id: fixture.runId, organizationId: ORGANIZATION_ID } });
    await tx.bonusRuleSet.deleteMany({ where: { id: fixture.ruleSetId, organizationId: ORGANIZATION_ID } });
  });
  if (fixture.paymentId) await db.payment.deleteMany({ where: { id: fixture.paymentId, organizationId: ORGANIZATION_ID } });
  await cleanupSeededReceipt(fixture.receipt);
}

test.describe("Bonus review and approval", () => {
  test("opens source receipt and policy and returns to the same projection", async ({ page }) => {
    const fixture = await createBonusFixture({ year: 2001, status: "REVIEW" });
    try {
      await authenticatePageAsAdmin(page);
      await page.goto(`/bonuses?run=${encodeURIComponent(fixture.runId)}`);

      await page.getByRole("link", { name: /^Recibo / }).click();
      await expect(page).toHaveURL(new RegExp(`/receipts/${fixture.receipt.id}\\?returnTo=`));
      await page.getByRole("link", { name: "Volver" }).click();
      await expect(page).toHaveURL(new RegExp(`/bonuses\\?run=${fixture.runId}`));

      await page.getByRole("link", { name: /^Póliza / }).click();
      await expect(page).toHaveURL(new RegExp(`/policies/${fixture.receipt.policyId}\\?returnTo=`));
      await page.getByRole("link", { name: "Volver" }).click();
      await expect(page).toHaveURL(new RegExp(`/bonuses\\?run=${fixture.runId}`));
    } finally {
      await cleanupBonusFixture(fixture);
    }
  });

  test("blocks an empty projection with a clear explanation", async ({ page }) => {
    const fixture = await createBonusFixture({ year: 2002, status: "READY", empty: true });
    try {
      await authenticatePageAsAdmin(page);
      await page.goto(`/bonuses?run=${encodeURIComponent(fixture.runId)}`);

      await expect(page.getByRole("button", { name: "Aprobar cierre" })).toBeDisabled();
      await expect(page.getByText("No se puede aprobar una proyección sin pagos. Genera una proyección que incluya partidas de pago.")).toBeVisible();
      expect(await getTestDb().bonusRun.findUniqueOrThrow({ where: { id: fixture.runId }, select: { status: true } })).toMatchObject({ status: "READY" });
    } finally {
      await cleanupBonusFixture(fixture);
    }
  });

  test("shows a reload action after a stale premium-review submission", async ({ page }) => {
    const fixture = await createBonusFixture({ year: 2003, status: "REVIEW", itemReason: PREMIUM_REVIEW_REASON });
    try {
      await authenticatePageAsAdmin(page);
      await page.goto(`/bonuses?run=${encodeURIComponent(fixture.runId)}`);
      await getTestDb().bonusRun.update({ where: { id: fixture.runId }, data: { version: { increment: 1 } } });

      await page.getByLabel(/Acepto la prima neta derivada para esta póliza/).check();
      await page.getByRole("button", { name: "Hacer computables" }).click();
      await expect(page.locator("div[role=alert]").filter({ hasText: "La proyección cambió desde que la abriste" })).toBeVisible();
      await page.getByRole("link", { name: "Recargar y revisar la versión actual" }).click();
      await expect(page.getByText(/Versión de cálculo 2\./)).toBeVisible();
      expect(await getTestDb().bonusRun.findUniqueOrThrow({ where: { id: fixture.runId }, select: { version: true, status: true } })).toMatchObject({ version: 2, status: "REVIEW" });
    } finally {
      await cleanupBonusFixture(fixture);
    }
  });

  test("rejects approval of a stale version and offers the current projection", async ({ page }) => {
    const fixture = await createBonusFixture({ year: 2005, status: "READY", itemStatus: "INCLUDED", includePayment: true });
    try {
      await authenticatePageAsAdmin(page);
      await page.goto(`/bonuses?run=${encodeURIComponent(fixture.runId)}`);
      await getTestDb().bonusRun.update({ where: { id: fixture.runId }, data: { version: { increment: 1 } } });

      await page.getByRole("checkbox").last().check();
      await page.getByRole("button", { name: "Aprobar cierre" }).click();
      await expect(page.locator("div[role=alert]").filter({ hasText: "La proyección cambió desde que la abriste" })).toBeVisible();
      await page.getByRole("link", { name: "Recargar y revisar la versión actual" }).click();

      await expect(page.getByText(/Versión de cálculo 2\./)).toBeVisible();
      expect(await getTestDb().bonusRun.findUniqueOrThrow({ where: { id: fixture.runId }, select: { version: true, status: true } }))
        .toMatchObject({ version: 2, status: "READY" });
    } finally {
      await cleanupBonusFixture(fixture);
    }
  });

  test("approves a closed-period run with a zero bonus and leaves payments and commissions unchanged", async ({ page }) => {
    const fixture = await createBonusFixture({ year: 2004, status: "READY", itemStatus: "INCLUDED", includePayment: true });
    const db = getTestDb();
    try {
      const paymentCount = await db.payment.count({ where: { organizationId: ORGANIZATION_ID, policyId: fixture.receipt.policyId } });
      const commissionCount = await db.commission.count({ where: { organizationId: ORGANIZATION_ID, policyId: fixture.receipt.policyId } });
      await authenticatePageAsAdmin(page);
      await page.goto(`/bonuses?run=${encodeURIComponent(fixture.runId)}`);
      await page.getByRole("checkbox").last().check();
      await page.getByRole("button", { name: "Aprobar cierre" }).click();

      await expect(page.getByText(/Aprobado por CI Admin/)).toBeVisible();
      const approvedRun = await db.bonusRun.findUniqueOrThrow({ where: { id: fixture.runId }, select: { status: true, bonusAmount: true } });
      expect(approvedRun.status).toBe("APPROVED");
      expect(approvedRun.bonusAmount?.toString()).toBe("0");
      expect(await db.payment.count({ where: { organizationId: ORGANIZATION_ID, policyId: fixture.receipt.policyId } })).toBe(paymentCount);
      expect(await db.commission.count({ where: { organizationId: ORGANIZATION_ID, policyId: fixture.receipt.policyId } })).toBe(commissionCount);
    } finally {
      await cleanupBonusFixture(fixture);
    }
  });
});
