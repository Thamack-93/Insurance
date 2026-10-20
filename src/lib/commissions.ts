import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { businessAddDays } from "@/lib/business-dates";
import { today } from "@/lib/dates";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import type { CommissionStatus } from "@/lib/domain-values";
import { commissionOperationalWhere } from "@/lib/portfolio-access";
import {
  assertOrganizationContextInTransaction,
  requireOrganizationContext,
  withTenantTransaction,
} from "@/lib/organization-context";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { OptimisticConcurrencyError } from "@/lib/optimistic-concurrency";
import { deriveReceiptNetPremium, reconcileEndorsementReceiptPremium, reconcilePolicyReceiptPremium } from "@/lib/premium-breakdown";
import { calculateCommissionEstimate, parseCommissionRules, roundMoney, type CommissionEstimate, type CommissionPremiumComponents, type CommissionRule } from "@/lib/commissions.logic";

type CommissionScope = {
  organizationId: string;
  portfolioOwnerId?: string;
};

async function requireCommissionScope(scope: CommissionScope): Promise<CommissionScope> {
  const context = await requireOrganizationContext();
  if (scope.organizationId !== context.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  if (context.membershipRole === "AGENT" && scope.portfolioOwnerId && scope.portfolioOwnerId !== context.userId) {
    throw new Error("PORTFOLIO_SCOPE_MISMATCH");
  }
  return { organizationId: context.organizationId, portfolioOwnerId: context.membershipRole === "AGENT" ? context.userId : scope.portfolioOwnerId };
}

export interface CommissionCalculation {
  policyId: string;
  clientId: string;
  insurerId: string;
  receiptId?: string;
  expectedAmount: number;
  actualAmount?: number;
  percentage: number;
  expectedDate: Date;
  status: "EXPECTED" | "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
}

export async function calculateCommissionsForPolicy(
  policyId: string,
  receiptId?: string,
): Promise<MutationResult> {
  if (!receiptId) return errorResult("El cálculo debe solicitarse para un recibo específico.");
  return calculateCommissionForReceipt(receiptId, policyId);
}

type ReceiptUnitInput = { insuredAssetId: string; totalPremium: number; vatAmount: number; issuanceExpenseAmount: number; surchargeAmount: number; discountAmount: number };

function jsonUnitBreakdown(value: unknown): ReceiptUnitInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is ReceiptUnitInput => Boolean(row && typeof row === "object" && typeof (row as ReceiptUnitInput).insuredAssetId === "string"));
}

function premiumComponents(source: Partial<ReceiptUnitInput> | { amount: unknown; vatAmount: unknown; issuanceExpenseAmount: unknown; surchargeAmount: unknown; discountAmount: unknown }): CommissionPremiumComponents | null {
  const raw = source as Record<string, unknown>;
  const numbers = "totalPremium" in source
    ? [raw.totalPremium, raw.vatAmount, raw.issuanceExpenseAmount, raw.surchargeAmount, raw.discountAmount]
    : [raw.amount, raw.vatAmount, raw.issuanceExpenseAmount, raw.surchargeAmount, raw.discountAmount];
  if (numbers.some((value) => value === null || value === undefined || value === "")) return null;
  const [totalPremium, iva, issuanceExpense, installmentSurcharge, visibleDiscounts] = numbers.map(Number);
  return { totalPremium, iva, issuanceExpense, installmentSurcharge, visibleDiscounts };
}

/** Calculates one receipt from an exact tenant-scoped rule and stores its auditable snapshot. */
export async function calculateCommissionForReceipt(receiptId: string, expectedPolicyId?: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    if (context.membershipRole === "AGENT") return errorResult("Solo Owner o Admin puede calcular comisiones.");
    return await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const receipt = await tx.receipt.findFirst({
        where: { id: receiptId, organizationId: context.organizationId, ...(expectedPolicyId ? { policyId: expectedPolicyId } : {}) },
        include: { policy: { include: { insuredAssets: { select: { id: true, description: true, unitClass: true } } } }, insurer: true, commissions: { select: { id: true } } },
      });
      if (!receipt) return errorResult("El recibo no existe en esta organización.");
      if (receipt.status === "CANCELLED") return errorResult("No se calcula comisión para un recibo cancelado.");
      if (receipt.commissions.length) return errorResult("Este recibo ya tiene una comisión guardada. No se sobrescriben cálculos históricos.");

      let reconciliation: { difference: number; status: "RECONCILED" | "REVIEW" };
      if (receipt.endorsementId) {
        const endorsement = await tx.policyEndorsement.findFirst({ where: { id: receipt.endorsementId, policyId: receipt.policyId, organizationId: context.organizationId }, select: { amount: true } });
        const endorsementReceipts = await tx.receipt.findMany({ where: { endorsementId: receipt.endorsementId, policyId: receipt.policyId, organizationId: context.organizationId }, select: { amount: true, status: true } });
        reconciliation = endorsement
          ? reconcileEndorsementReceiptPremium(Number(endorsement.amount), endorsementReceipts.map((row) => ({ amount: Number(row.amount), status: row.status })))
          : { difference: Number(receipt.amount), status: "REVIEW" };
      } else {
        const baseReceipts = await tx.receipt.findMany({ where: { policyId: receipt.policyId, organizationId: context.organizationId, endorsementId: null }, select: { amount: true, status: true } });
        reconciliation = reconcilePolicyReceiptPremium(Number(receipt.policy.premiumAmount), baseReceipts.map((row) => ({ amount: Number(row.amount), status: row.status })));
      }
      if (reconciliation.status !== "RECONCILED") {
        const reason = `La prima no concilia con los recibos vigentes (diferencia ${reconciliation.difference.toFixed(2)} ${receipt.currency}); revisa recibos antes de calcular.`;
        await tx.receipt.update({ where: { id: receipt.id }, data: { commissionCalculationStatus: "REVIEW", commissionReviewReason: reason, updatedById: context.userId } });
        return errorResult(reason);
      }
      const claim = await tx.receipt.updateMany({
        where: { id: receipt.id, organizationId: context.organizationId, commissionCalculationStatus: { in: ["NOT_CALCULATED", "REVIEW"] } },
        data: { commissionCalculationStatus: "CALCULATING", updatedById: context.userId },
      });
      if (claim.count !== 1) return errorResult("El cálculo ya está en curso o ya se guardó. Actualiza el recibo para ver el resultado.");

      const riskDetails = receipt.policy.riskDetails && typeof receipt.policy.riskDetails === "object" ? receipt.policy.riskDetails as Record<string, unknown> : {};
      const riskData = riskDetails.data && typeof riskDetails.data === "object" ? riskDetails.data as Record<string, unknown> : {};
      const policyModeValue = typeof riskDetails.commissionPolicyMode === "string" && riskDetails.commissionPolicyMode.trim()
        ? riskDetails.commissionPolicyMode
        : receipt.policy.policyType === "AUTO" && typeof riskData.policyMode === "string" ? riskData.policyMode : "";
      const policyMode = policyModeValue.trim().toUpperCase();
      const policyUnitClass = typeof riskDetails.commissionUnitClass === "string" ? riskDetails.commissionUnitClass.trim().toUpperCase() : "";
      const productPlan = receipt.policy.paymentPlan?.trim() || (typeof riskData.plan === "string" ? riskData.plan.trim() : "") || "SIN_PLAN";
      const rules = parseCommissionRules(receipt.insurer.commissionRules);
      const rows = jsonUnitBreakdown(receipt.premiumBreakdownByUnit);
      const assets = receipt.policy.insuredAssets;
      const calculations: Array<{ assetId: string | null; description: string; unitClass: string; components: CommissionPremiumComponents; estimate: CommissionEstimate & { amount: number; commissionableBase: number; rate: number; rule: CommissionRule } }> = [];
      let reviewReason: string | null = null;

      if (!policyMode) {
        reviewReason = "Indica la modalidad de la póliza para aplicar una regla de comisión.";
      } else if (assets.length) {
        const byAsset = new Map(rows.map((row) => [row.insuredAssetId, row]));
        if (deriveReceiptNetPremium({ amount: Number(receipt.amount), premiumBreakdownByUnit: rows }) === null) {
          reviewReason = "El desglose de prima por unidad está incompleto o no concilia con el importe del recibo.";
        } else if (byAsset.size !== assets.length || assets.some((asset) => !byAsset.has(asset.id)) || rows.some((row) => !assets.some((asset) => asset.id === row.insuredAssetId))) {
          reviewReason = "Completa el desglose de prima por cada unidad asegurada antes de calcular.";
        } else {
          for (const asset of assets) {
            const row = byAsset.get(asset.id)!;
            if (!asset.unitClass?.trim()) { reviewReason = `Clasifica la unidad ${asset.description} antes de calcular.`; break; }
            const components = premiumComponents(row);
            if (components && components.totalPremium <= 0) { reviewReason = `Captura la prima total de ${asset.description}.`; break; }
            const estimate = calculateCommissionEstimate(components, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass: asset.unitClass.trim().toUpperCase(), paymentFrequency: receipt.policy.paymentFrequency }, receipt.dueDate);
            if (estimate.status !== "CALCULATED" || estimate.amount === undefined) { reviewReason = `${asset.description}: ${estimate.reason}`; break; }
            calculations.push({ assetId: asset.id, description: asset.description, unitClass: asset.unitClass.trim().toUpperCase(), components: components!, estimate: estimate as typeof calculations[number]["estimate"] });
          }
        }
      } else {
        const components = premiumComponents(receipt);
        if (!policyUnitClass) reviewReason = "Indica la clase de riesgo asegurada para aplicar una regla de comisión.";
        else if (components && components.totalPremium <= 0) reviewReason = "Captura la prima total antes de calcular.";
        const estimate = calculateCommissionEstimate(components, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass: policyUnitClass, paymentFrequency: receipt.policy.paymentFrequency }, receipt.dueDate);
        if (!reviewReason && (estimate.status !== "CALCULATED" || estimate.amount === undefined)) reviewReason = estimate.reason ?? "Revisa los datos de comisión.";
        else if (!reviewReason) calculations.push({ assetId: null, description: "Póliza", unitClass: "POLICY", components: components!, estimate: estimate as typeof calculations[number]["estimate"] });
      }

      if (reviewReason) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { commissionCalculationStatus: "REVIEW", commissionReviewReason: reviewReason, updatedById: context.userId } });
        return errorResult(reviewReason);
      }

      const expectedAmount = roundMoney(calculations.reduce((sum, item) => sum + (item.estimate.amount ?? 0), 0));
      const totalBase = calculations.reduce((sum, item) => sum + (item.estimate.commissionableBase ?? 0), 0);
      const percentage = totalBase ? roundMoney(calculations.reduce((sum, item) => sum + (item.estimate.commissionableBase! * item.estimate.rate!), 0) / totalBase) : 0;
      const expectedDate = businessAddDays(receipt.dueDate, 30);
      const breakdown = calculations.map((item) => ({ assetId: item.assetId, description: item.description, unitClass: item.unitClass, components: { totalPremium: item.components.totalPremium, vatAmount: item.components.iva, issuanceExpenseAmount: item.components.issuanceExpense, surchargeAmount: item.components.installmentSurcharge, discountAmount: item.components.visibleDiscounts }, netPremium: item.estimate.netPremium, commissionableBase: item.estimate.commissionableBase, rate: item.estimate.rate, expectedAmount: item.estimate.amount, ruleId: item.estimate.rule?.id, ruleEvidence: item.estimate.rule?.evidence }));
      const commission = await tx.commission.create({ data: { organizationId: context.organizationId, policyId: receipt.policyId, receiptId: receipt.id, clientId: receipt.clientId, insurerId: receipt.insurerId, expectedAmount, percentage, expectedDate, status: receipt.status === "PAID" ? "PENDING" : "EXPECTED", calculationBreakdownJson: JSON.stringify({ calculatedAt: new Date().toISOString(), ruleVersion: receipt.insurer.commissionRulesVersion, breakdown }) } });
      await tx.receipt.update({ where: { id: receipt.id }, data: { commissionCalculationStatus: "CALCULATED", commissionReviewReason: null, updatedById: context.userId } });
      await writeActivityLog({ action: "CALCULATE_COMMISSION", entityType: "COMMISSION", entityId: commission.id, organizationId: context.organizationId, userId: context.userId, db: tx, newValue: { policyId: receipt.policyId, receiptId, expectedAmount, percentage, breakdown } });
      return successResult(commission.id, `/receipts/${receipt.id}`, `Comisión esperada calculada: ${expectedAmount.toFixed(2)} ${receipt.currency}.`);
    });
  } catch (error) {
    logError("commissions.calculateCommissionForReceipt", error, { receiptId });
    return errorResult("No se pudieron calcular las comisiones. Intenta de nuevo.");
  }
}

export async function updateCommissionStatus(
  commissionId: string,
  status: CommissionStatus,
  actualAmount?: number,
  expectedVersion?: number,
): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const portfolioOwnerId = context.membershipRole === "AGENT" ? context.userId : undefined;
    return await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const commission = await tx.commission.findFirst({
      where: { id: commissionId, ...commissionOperationalWhere(portfolioOwnerId, context.organizationId) },
      include: {
        policy: true,
        client: true,
        insurer: true,
      },
    });

    if (!commission) {
      return errorResult("La comisión no existe o fue eliminada.");
    }

    const updateData: Prisma.CommissionUpdateInput = {
      status,
      updatedAt: new Date(),
      ...(actualAmount !== undefined && status === "PAID"
        ? { actualAmount, paidDate: new Date() }
        : {}),
    };

    const updated = await tx.commission.updateMany({
      where: { id: commissionId, ...commissionOperationalWhere(portfolioOwnerId, context.organizationId), ...(expectedVersion === undefined ? {} : { version: expectedVersion }) },
      data: { ...updateData, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new OptimisticConcurrencyError("La comisión", expectedVersion ?? commission.version);

    // Log activity
    await writeActivityLog({
      action: "UPDATE_COMMISSION_STATUS",
      entityType: "COMMISSION",
      entityId: commissionId,
      organizationId: context.organizationId,
      userId: context.userId,
      db: tx,
      oldValue: JSON.stringify({
        status: commission.status,
        actualAmount: commission.actualAmount,
      }),
      newValue: JSON.stringify({
        status,
        actualAmount: actualAmount || commission.actualAmount,
      }),
    });

    return successResult(
      commission.id,
      `/commissions/${commission.id}`,
      "Estado de comisión actualizado.",
    );
    });
  } catch (error) {
    logError("commissions.updateCommissionStatus", error, { commissionId, status });
    return errorResult("No se pudo actualizar el estado de la comisión. Intenta de nuevo.");
  }
}

export async function getCommissionStats(
  dateRange: { start: Date; end: Date } | undefined,
  scope: CommissionScope,
) {
  scope = await requireCommissionScope(scope);
  
  try {
    const whereClause: Prisma.CommissionWhereInput = {
      ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
      ...(dateRange
        ? {
          expectedDate: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        }
        : {}),
    };

    return await withTenantOrganization(scope.organizationId, async (db) => {
    const stats = await db.commission.aggregate({
      where: { ...whereClause, organizationId: scope.organizationId },
      _sum: {
        expectedAmount: true,
        actualAmount: true,
      },
      _count: {
        id: true,
      },
    });

    const statusBreakdown = await db.commission.groupBy({
      by: ["status"],
      where: { ...whereClause, organizationId: scope.organizationId },
      _sum: {
        expectedAmount: true,
        actualAmount: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalExpected: Number(stats._sum.expectedAmount || 0),
      totalActual: Number(stats._sum.actualAmount || 0),
      totalCount: stats._count.id,
      statusBreakdown: statusBreakdown.map(item => ({
        status: item.status,
        count: item._count.id,
        expectedAmount: Number(item._sum.expectedAmount || 0),
        actualAmount: Number(item._sum.actualAmount || 0),
      })),
    };
    });
  } catch (error) {
    logError("commissions.getCommissionStats", error);
    return {
      totalExpected: 0,
      totalActual: 0,
      totalCount: 0,
      statusBreakdown: [],
    };
  }
}

export async function getOverdueCommissions(scope: CommissionScope) {
  scope = await requireCommissionScope(scope);
  try {
    const todayDate = today();
    const overdueCommissions = await withTenantOrganization(scope.organizationId, (db) => db.commission.findMany({
      where: {
        ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        expectedDate: {
          lt: todayDate,
        },
        status: {
          in: ["EXPECTED", "PENDING"],
        },
      },
      include: {
        policy: {
          select: {
            policyNumber: true,
            policyType: true,
          },
        },
        client: {
          select: {
            fullName: true,
            email: true,
          },
        },
        insurer: {
          select: {
            name: true,
          },
        },
        receipt: {
          select: {
            receiptNumber: true,
            dueDate: true,
          },
        },
      },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
    }));

    return overdueCommissions.map(commission => ({
      ...commission,
      expectedAmount: Number(commission.expectedAmount),
      actualAmount: commission.actualAmount ? Number(commission.actualAmount) : null,
      percentage: Number(commission.percentage),
    }));
  } catch (error) {
    logError("commissions.getOverdueCommissions", error);
    return [];
  }
}

export async function autoUpdateCommissionStatuses(scope: CommissionScope) {
  scope = await requireCommissionScope(scope);
  try {
    const todayDate = today();
    const operationalWhere = commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId);

    // Sequential transitions: a commission may need EXPECTED→PENDING→OVERDUE
    // in the same run if its receipt was just paid AND it's already past due.
    return await withTenantOrganization(scope.organizationId, async (db) => {
    const pendingResult = await db.commission.updateMany({
      where: {
        organizationId: scope.organizationId,
        ...operationalWhere,
        status: "EXPECTED",
        receipt: { status: "PAID" },
      },
      data: { status: "PENDING", updatedAt: new Date() },
    });
    const overdueResult = await db.commission.updateMany({
      where: {
        organizationId: scope.organizationId,
        ...operationalWhere,
        status: "PENDING",
        expectedDate: { lt: todayDate },
      },
      data: { status: "OVERDUE", updatedAt: new Date() },
    });

    return {
      updatedToPending: pendingResult.count,
      updatedToOverdue: overdueResult.count,
    };
    });
  } catch (error) {
    logError("commissions.autoUpdateCommissionStatuses", error);
    return {
      updatedToPending: 0,
      updatedToOverdue: 0,
    };
  }
}
