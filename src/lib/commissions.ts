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
import { autoPolicyModeForCount, autoVehicleCount } from "@/lib/auto-policy-mode";
import { calculateCommissionEstimate, canCalculateCommissionForReceipt, parseCommissionRules, roundMoney, shouldRequirePolicyPremiumReconciliation, shouldUseAggregatePolicyOverride, type CommissionEstimate, type CommissionPremiumComponents, type CommissionRule } from "@/lib/commissions.logic";

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

function normalizeCommissionMatch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toUpperCase();
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
        include: {
          policy: { include: { insuredAssets: { select: { id: true, description: true, unitClass: true } } } },
          insurer: true,
          commissions: { select: { id: true } },
          payments: { where: { organizationId: context.organizationId, status: "POSTED" }, select: { id: true } },
        },
      });
      if (!receipt) return errorResult("El recibo no existe en esta organización.");
      if (!canCalculateCommissionForReceipt(receipt.status, receipt.payments.length)) return errorResult("No se calcula comisión para un recibo cancelado sin pagos POSTED.");
      if (receipt.commissions.length) return errorResult("Este recibo ya tiene una comisión guardada. No se sobrescriben cálculos históricos.");

      let reconciliation: { difference: number; status: "RECONCILED" | "REVIEW" };
      let endorsementConcept = "";
      if (receipt.endorsementId) {
        const endorsement = await tx.policyEndorsement.findFirst({ where: { id: receipt.endorsementId, policyId: receipt.policyId, organizationId: context.organizationId }, select: { amount: true, concept: true } });
        const endorsementReceipts = await tx.receipt.findMany({ where: { endorsementId: receipt.endorsementId, policyId: receipt.policyId, organizationId: context.organizationId }, select: { amount: true, status: true } });
        endorsementConcept = endorsement?.concept ?? "";
        reconciliation = endorsement
          ? reconcileEndorsementReceiptPremium(Number(endorsement.amount), endorsementReceipts.map((row) => ({ amount: Number(row.amount), status: row.status })))
          : { difference: Number(receipt.amount), status: "REVIEW" };
      } else {
        const baseReceipts = await tx.receipt.findMany({
          where: { policyId: receipt.policyId, organizationId: context.organizationId, endorsementId: null },
          select: {
            id: true,
            amount: true,
            status: true,
            receiptSequence: true,
            cancelledAt: true,
            cancellationReason: true,
            payments: { where: { organizationId: context.organizationId, status: "POSTED" }, select: { id: true } },
          },
        });
        reconciliation = reconcilePolicyReceiptPremium(Number(receipt.policy.premiumAmount), baseReceipts.map((row) => ({
          id: row.id,
          amount: Number(row.amount),
          status: row.status,
          receiptSequence: row.receiptSequence,
          cancelledAt: row.cancelledAt,
          cancellationReason: row.cancellationReason,
          postedPaymentCount: row.payments.length,
        })), { includePaidCancelledReceipts: true });
      }
      if (reconciliation.status !== "RECONCILED" && shouldRequirePolicyPremiumReconciliation(receipt.status, receipt.payments.length)) {
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
      const assets = receipt.policy.insuredAssets;
      const policyModeValue = receipt.policy.policyType === "AUTO"
        ? "*"
        : typeof riskDetails.commissionPolicyMode === "string" && riskDetails.commissionPolicyMode.trim()
          ? riskDetails.commissionPolicyMode
          : "";
      const policyMode = policyModeValue.trim().toUpperCase();
      const policyUnitClass = typeof riskDetails.commissionUnitClass === "string" ? riskDetails.commissionUnitClass.trim().toUpperCase() : "";
      const productPlan = receipt.policy.paymentPlan?.trim().toUpperCase() || (typeof riskData.plan === "string" ? riskData.plan.trim().toUpperCase() : "") || "SIN_PLAN";
      const rules = parseCommissionRules(receipt.insurer.commissionRules);
      const policyRateOverride = receipt.policy.commissionRateOverride === null ? null : Number(receipt.policy.commissionRateOverride);
      // Commission reports are cut by the date the client paid. Use that same
      // date to select a rate for paid receipts; unpaid estimates use due date.
      const ruleDate = receipt.paidDate ?? receipt.dueDate;
      const storedRows = jsonUnitBreakdown(receipt.premiumBreakdownByUnit);
      const aggregateComponents = premiumComponents(receipt);
      const aggregateNetPremium = deriveReceiptNetPremium({
        amount: Number(receipt.amount),
        vatAmount: receipt.vatAmount === null ? null : Number(receipt.vatAmount),
        issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : Number(receipt.issuanceExpenseAmount),
        surchargeAmount: receipt.surchargeAmount === null ? null : Number(receipt.surchargeAmount),
        discountAmount: receipt.discountAmount === null ? null : Number(receipt.discountAmount),
      });
      const storedNetPremium = deriveReceiptNetPremium({ amount: Number(receipt.amount), premiumBreakdownByUnit: storedRows });
      const singleUnitBreakdownConflicts = assets.length === 1
        && aggregateNetPremium !== null
        && storedNetPremium !== null
        && Math.abs(aggregateNetPremium - storedNetPremium) > 0.01;
      // A single insured asset has no allocation ambiguity: use the receipt-level
      // premium breakdown as that unit's breakdown when its stored unit rows are
      // missing, incomplete, or fail to reconcile.
      // Multi-unit policies still require an explicit, reconciling allocation.
      const rows = assets.length === 1 && aggregateComponents && storedNetPremium === null
        ? [{
            insuredAssetId: assets[0].id,
            totalPremium: aggregateComponents.totalPremium,
            vatAmount: aggregateComponents.iva,
            issuanceExpenseAmount: aggregateComponents.issuanceExpense,
            surchargeAmount: aggregateComponents.installmentSurcharge,
            discountAmount: aggregateComponents.visibleDiscounts,
          }]
        : storedRows;
      // An endorsement receipt can carry zero-value rows for other people or
      // units on the base policy. Those rows reconcile the stored allocation,
      // but only positively charged units belong to this endorsement's premium.
      const positiveEndorsementRows = receipt.endorsementId
        ? rows.filter((row) => Number.isFinite(row.totalPremium) && row.totalPremium > 0)
        : [];
      const calculationRows = receipt.endorsementId ? positiveEndorsementRows : rows;
      const calculations: Array<{ assetId: string | null; description: string; unitClass: string; components: CommissionPremiumComponents; estimate: CommissionEstimate & { amount: number; commissionableBase: number; rate: number; rule: CommissionRule } }> = [];
      let reviewReason: string | null = null;
      const aggregatePolicyOverride = shouldUseAggregatePolicyOverride({
        hasInsuredAssets: assets.length > 0,
        policyRateOverride,
        aggregateComponents,
        unitBreakdownCount: storedRows.length,
      });

      // Policy-level totals are sufficient for a multi-person/unit policy when
      // every insured risk resolves to the same commission rule and rate. This
      // calculates the aggregate once instead of inventing an allocation per unit.
      const aggregateAssetEstimates = !receipt.endorsementId && assets.length && aggregateComponents && aggregateNetPremium !== null
        && (policyRateOverride !== null || Boolean(policyUnitClass) || assets.every((asset) => Boolean(asset.unitClass?.trim())))
        ? assets.map((asset) => {
            const unitClass = asset.unitClass?.trim().toUpperCase() || policyUnitClass || "POLICY_OVERRIDE";
            const estimate = calculateCommissionEstimate(aggregateComponents, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass, paymentFrequency: receipt.policy.paymentFrequency }, ruleDate, policyRateOverride);
            return { asset, unitClass, estimate };
          })
        : [];
      const aggregateRuleKeys = aggregateAssetEstimates.map(({ estimate }) => `${estimate.rule?.id ?? (policyRateOverride === null ? "NO_RULE" : "POLICY_OVERRIDE")}:${estimate.rate ?? "REVIEW"}`);
      const canCalculateAggregateAssets = aggregateAssetEstimates.length === assets.length
        && aggregateAssetEstimates.length > 0
        && aggregateAssetEstimates.every(({ estimate }) => estimate.status === "CALCULATED" && estimate.amount !== undefined)
        && new Set(aggregateRuleKeys).size === 1;
      if (canCalculateAggregateAssets && aggregateComponents) {
        const first = aggregateAssetEstimates[0]!;
        calculations.push({
          assetId: null,
          description: `Póliza (${assets.length} riesgos asegurados; desglose capturado a nivel póliza)`,
          unitClass: "POLICY_AGGREGATE",
          components: aggregateComponents,
          estimate: first.estimate as typeof calculations[number]["estimate"],
        });
      }

      // An empty modality can still resolve to a rule configured with policyMode="*".
      // If the insurer differentiates rates by modality, only a matching specific rule
      // can calculate; otherwise calculateCommissionEstimate leaves the receipt in REVIEW.
      if (assets.length && !canCalculateAggregateAssets) {
        const byAsset = new Map(calculationRows.map((row) => [row.insuredAssetId, row]));
        const endorsementPartyIds = receipt.endorsementId
          ? new Set(assets.filter((asset) => {
              const concept = normalizeCommissionMatch(endorsementConcept);
              const name = normalizeCommissionMatch(asset.description);
              return Boolean(name) && (concept.includes(name) || name.includes(concept));
            }).map((asset) => asset.id))
          : null;
        const calculationAssets = receipt.endorsementId
          ? assets.filter((asset) => byAsset.has(asset.id) && endorsementPartyIds?.has(asset.id))
          : assets;
        if (aggregatePolicyOverride && aggregateComponents) {
          if (receipt.endorsementId && endorsementPartyIds?.size !== 1) {
            reviewReason = "El endoso no identifica con claridad a la persona cuyo importe se desglosa.";
          } else if (aggregateComponents.totalPremium <= 0) {
            reviewReason = "Captura la prima total antes de calcular.";
          } else {
            const unitClass = policyUnitClass || "POLICY_OVERRIDE";
            const estimate = calculateCommissionEstimate(aggregateComponents, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass, paymentFrequency: receipt.policy.paymentFrequency }, ruleDate, policyRateOverride);
            if (estimate.status !== "CALCULATED" || estimate.amount === undefined) reviewReason = estimate.reason ?? "Revisa los datos de comisión.";
            else calculations.push({ assetId: null, description: "Póliza (tasa específica)", unitClass, components: aggregateComponents, estimate: estimate as typeof calculations[number]["estimate"] });
          }
        } else if (singleUnitBreakdownConflicts) {
          reviewReason = "El desglose del recibo y el desglose de su única unidad difieren; concílialos antes de calcular.";
        } else if (deriveReceiptNetPremium({ amount: Number(receipt.amount), premiumBreakdownByUnit: rows }) === null) {
          reviewReason = "El desglose de prima por unidad está incompleto o no concilia con el importe del recibo.";
        } else if (receipt.endorsementId && (!endorsementPartyIds?.size || positiveEndorsementRows.length !== calculationAssets.length)) {
          reviewReason = "El endoso no identifica con claridad a las personas o unidades cuyo importe se desglosa.";
        } else if (!calculationAssets.length || byAsset.size !== calculationAssets.length || calculationAssets.some((asset) => !byAsset.has(asset.id)) || rows.some((row) => !assets.some((asset) => asset.id === row.insuredAssetId))) {
          reviewReason = "Completa el desglose por riesgo solo cuando las reglas de comisión difieran entre las unidades aseguradas.";
        } else {
          for (const asset of calculationAssets) {
            const row = byAsset.get(asset.id)!;
            if (policyRateOverride === null && !asset.unitClass?.trim()) { reviewReason = `Clasifica la unidad ${asset.description} antes de calcular.`; break; }
            const components = premiumComponents(row);
            if (components && components.totalPremium <= 0) { reviewReason = `Captura la prima total de ${asset.description}.`; break; }
            const unitClass = asset.unitClass?.trim().toUpperCase() || policyUnitClass || "POLICY_OVERRIDE";
            const estimate = calculateCommissionEstimate(components, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass, paymentFrequency: receipt.policy.paymentFrequency }, ruleDate, policyRateOverride);
            if (estimate.status !== "CALCULATED" || estimate.amount === undefined) { reviewReason = `${asset.description}: ${estimate.reason}`; break; }
            calculations.push({ assetId: asset.id, description: asset.description, unitClass, components: components!, estimate: estimate as typeof calculations[number]["estimate"] });
          }
        }
      } else if (!assets.length) {
        const components = premiumComponents(receipt);
        if (policyRateOverride === null && !policyUnitClass) reviewReason = "Indica la clase de riesgo asegurada para aplicar una regla de comisión.";
        else if (components && components.totalPremium <= 0) reviewReason = "Captura la prima total antes de calcular.";
        const estimate = calculateCommissionEstimate(components, rules, { policyType: receipt.policy.policyType, productPlan, policyMode, unitClass: policyUnitClass || "POLICY_OVERRIDE", paymentFrequency: receipt.policy.paymentFrequency }, ruleDate, policyRateOverride);
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
      const breakdown = calculations.map((item) => ({ assetId: item.assetId, description: item.description, unitClass: item.unitClass, components: { totalPremium: item.components.totalPremium, vatAmount: item.components.iva, issuanceExpenseAmount: item.components.issuanceExpense, surchargeAmount: item.components.installmentSurcharge, discountAmount: item.components.visibleDiscounts }, netPremium: item.estimate.netPremium, commissionableBase: item.estimate.commissionableBase, rate: item.estimate.rate, expectedAmount: item.estimate.amount, ruleId: item.estimate.rule?.id, ruleSource: item.estimate.rule?.source ?? "INSURER_RULE", ruleEvidence: item.estimate.rule?.evidence }));
      const commission = await tx.commission.create({ data: { organizationId: context.organizationId, policyId: receipt.policyId, receiptId: receipt.id, clientId: receipt.clientId, insurerId: receipt.insurerId, expectedAmount, percentage, expectedDate, status: receipt.status === "PAID" || receipt.payments.length > 0 ? "PENDING" : "EXPECTED", calculationBreakdownJson: JSON.stringify({ calculatedAt: new Date().toISOString(), ruleVersion: receipt.insurer.commissionRulesVersion, breakdown }) } });
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
