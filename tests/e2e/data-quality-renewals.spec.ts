import { expect, test } from "@playwright/test";
import { addDays } from "date-fns";
import { authenticatePageAsAdmin, getTestDb } from "../helpers/db";

type SeededRenewalCase = {
  sourcePolicyId: string;
  targetPolicyId?: string;
  sourceReceiptId: string;
  suggestionId: string;
  workItemId: string;
  sourcePolicyNumber: string;
};

test.describe("Data quality renewals tab", () => {
  const policyIds = new Set<string>();
  const receiptIds = new Set<string>();
  const suggestionIds = new Set<string>();
  const workItemIds = new Set<string>();

  test.afterEach(async () => {
    const db = getTestDb();

    if (suggestionIds.size > 0) {
      await db.policyRenewalSuggestion.deleteMany({
        where: { id: { in: [...suggestionIds] } },
      });
    }

    if (workItemIds.size > 0) {
      await db.workItem.deleteMany({
        where: { id: { in: [...workItemIds] } },
      });
    }

    if (receiptIds.size > 0) {
      await db.payment.deleteMany({
        where: { receiptId: { in: [...receiptIds] } },
      });
      await db.receipt.deleteMany({
        where: { id: { in: [...receiptIds] } },
      });
    }

    if (policyIds.size > 0) {
      await db.policy.deleteMany({
        where: { id: { in: [...policyIds] } },
      });
    }

    policyIds.clear();
    receiptIds.clear();
    suggestionIds.clear();
    workItemIds.clear();
  });

  async function seedRenewalCase(options?: { withTargetPolicy?: boolean }): Promise<SeededRenewalCase> {
    const db = getTestDb();
    const actor = await db.user.findFirst({
      where: { active: true },
      select: { id: true },
    });
    const client = await db.client.findFirst();
    const insurer = await db.insurer.findFirst();
    if (!actor || !client || !insurer) {
      test.skip(true, "No client or insurer found");
    }

    const nonce = Date.now().toString(36);
    const sourcePolicy = await db.policy.create({
      data: {
        policyNumber: `REN-DQ-${nonce}-SRC`,
        clientId: client!.id,
        insurerId: insurer!.id,
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: addDays(new Date(), -330),
        endDate: addDays(new Date(), 5),
        premiumAmount: 1800,
        currency: "MXN",
      },
    });
    policyIds.add(sourcePolicy.id);

    let targetPolicyId: string | undefined;
    const sourceReceipt = await db.receipt.create({
      data: {
        receiptNumber: `REN-DQ-${nonce}-REC`,
        policyId: sourcePolicy.id,
        clientId: client!.id,
        insurerId: insurer!.id,
        periodStartDate: sourcePolicy.startDate,
        periodEndDate: sourcePolicy.endDate,
        dueDate: sourcePolicy.endDate,
        amount: 1800,
        currency: "MXN",
        status: "PAID",
        paidDate: addDays(sourcePolicy.endDate, -1),
      },
    });
    receiptIds.add(sourceReceipt.id);
    await db.payment.create({
      data: {
        receiptId: sourceReceipt.id,
        policyId: sourcePolicy.id,
        clientId: client!.id,
        amount: 1800,
        currency: "MXN",
        paidDate: addDays(sourcePolicy.endDate, -1),
        paymentMethod: "TRANSFER",
        reference: `REN-DQ-${nonce}`,
        createdById: actor!.id,
        updatedById: actor!.id,
      },
    });

    if (options?.withTargetPolicy) {
      const targetPolicy = await db.policy.create({
        data: {
          policyNumber: `REN-DQ-${nonce}-DST`,
          clientId: client!.id,
          insurerId: insurer!.id,
          policyType: "AUTO",
          status: "PENDING",
          paymentFrequency: "ANNUAL",
          startDate: addDays(sourcePolicy.endDate, 1),
          endDate: addDays(sourcePolicy.endDate, 366),
          premiumAmount: 1950,
          currency: "MXN",
        },
      });
      policyIds.add(targetPolicy.id);
      targetPolicyId = targetPolicy.id;
    }

    const suggestion = await db.policyRenewalSuggestion.create({
      data: {
        sourcePolicyId: sourcePolicy.id,
        targetPolicyId: targetPolicyId ?? null,
        status: "PENDING",
        reason: "RENOVAL_MATCH_PENDING",
      },
    });
    suggestionIds.add(suggestion.id);

    const workItemId = `wi-${nonce}`;
    await db.workItem.create({
      data: {
        id: workItemId,
        sourceType: "Task",
        sourceId: workItemId,
        workItemType: "TASK",
        taskType: "RENEWAL",
        status: "OPEN",
        priority: "HIGH",
        folio: `TASK-RENEWAL-${nonce}`,
        title: `Renovación de póliza ${sourcePolicy.policyNumber}`,
        description: "Seguimiento generado para E2E.",
        entityType: "WorkItem",
        entityId: workItemId,
        clientId: client!.id,
        policyId: sourcePolicy.id,
        insurerId: insurer!.id,
        dueDate: sourcePolicy.endDate,
      },
    });
    workItemIds.add(workItemId);

    return {
      sourcePolicyId: sourcePolicy.id,
      targetPolicyId,
      sourceReceiptId: sourceReceipt.id,
      suggestionId: suggestion.id,
      workItemId,
      sourcePolicyNumber: sourcePolicy.policyNumber,
    };
  }

  test("loads /data-quality directly without redirecting to risks", async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/data-quality");

    await expect(page).toHaveURL(/\/data-quality$/);
    await expect(page.getByRole("heading", { name: "Data Quality", exact: true })).toBeVisible();
  });

  test("No renovada runs the real renewal-closing flow from data quality", async ({ page }) => {
    const seeded = await seedRenewalCase();

    await authenticatePageAsAdmin(page);
    await page.goto(`/data-quality?tab=renovaciones&q=${encodeURIComponent(seeded.sourcePolicyNumber)}`);

    const row = page.locator("tr", { hasText: seeded.sourcePolicyNumber });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "No renovada" }).click();

    const db = getTestDb();
    await expect
      .poll(async () => {
        const [suggestion, workItem] = await Promise.all([
          db.policyRenewalSuggestion.findUnique({ where: { id: seeded.suggestionId } }),
          db.workItem.findUnique({ where: { id: seeded.workItemId } }),
        ]);

        return {
          suggestionStatus: suggestion?.status,
          suggestionNote: suggestion?.resolutionNote,
          workItemStatus: workItem?.status,
          workItemClosed: Boolean(workItem?.closedDate),
        };
      })
      .toMatchObject({
        suggestionStatus: "DECLINED",
        suggestionNote: "Cerrado manualmente desde Renovaciones.",
        workItemStatus: "CANCELLED",
        workItemClosed: true,
      });
  });

  test("Aprobar selección links the renewal and resolves the open source follow-up", async ({ page }) => {
    const seeded = await seedRenewalCase({ withTargetPolicy: true });

    await authenticatePageAsAdmin(page);
    await page.goto(`/data-quality?tab=renovaciones&q=${encodeURIComponent(seeded.sourcePolicyNumber)}`);

    const row = page.locator("tr", { hasText: seeded.sourcePolicyNumber });
    await expect(row).toBeVisible();
    await row.locator('input[type="checkbox"][name="issueIds"]').check();
    await page.getByRole("button", { name: "Aprobar selección" }).click();

    const db = getTestDb();
    await expect
      .poll(async () => {
        const [sourcePolicy, targetPolicy, suggestion, workItem, receipt, paymentCount] = await Promise.all([
          db.policy.findUnique({ where: { id: seeded.sourcePolicyId } }),
          db.policy.findUnique({ where: { id: seeded.targetPolicyId! } }),
          db.policyRenewalSuggestion.findUnique({ where: { id: seeded.suggestionId } }),
          db.workItem.findUnique({ where: { id: seeded.workItemId } }),
          db.receipt.findUnique({ where: { id: seeded.sourceReceiptId } }),
          db.payment.count({ where: { receiptId: seeded.sourceReceiptId } }),
        ]);

        return {
          sourceStatus: sourcePolicy?.status,
          targetRenewedFromPolicyId: targetPolicy?.renewedFromPolicyId,
          targetStatus: targetPolicy?.status,
          suggestionStatus: suggestion?.status,
          suggestionTargetPolicyId: suggestion?.targetPolicyId,
          workItemStatus: workItem?.status,
          workItemClosed: Boolean(workItem?.closedDate),
          receiptStatus: receipt?.status,
          paymentCount,
        };
      })
      .toMatchObject({
        sourceStatus: "RENEWED",
        targetRenewedFromPolicyId: seeded.sourcePolicyId,
        targetStatus: "ACTIVE",
        suggestionStatus: "ACCEPTED",
        suggestionTargetPolicyId: seeded.targetPolicyId,
        workItemStatus: "RESOLVED",
        workItemClosed: true,
        receiptStatus: "PAID",
        paymentCount: 1,
      });
  });
});
