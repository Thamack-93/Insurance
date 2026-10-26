import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "@/lib/organization-context";
import { allocatePaidNetPremium, deriveReceiptNetPremium, reconcileEndorsementReceiptPremium, reconcilePolicyReceiptPremium } from "@/lib/premium-breakdown";
import { convertMoneyValue, loadCurrencyRates } from "@/lib/currency-rates";
import { autoPolicyModeForCount, countInsuredVehicles } from "@/lib/auto-policy-mode";
import { bonusPaymentWindow, damagePortfolioLossRatioStatus, normalizedInsurerName, selectBonusTier, type BonusProgram as ProgramRule } from "@/lib/bonus-rules";

export type BonusProjectionInput = { programKey: string; sellerId: string; year: number; periodNumber: number; damagePortfolioLossRatio?: number | null };
export type BonusProjectionItem = {
  paymentId: string;
  receiptId: string;
  policyId: string;
  status: "INCLUDED" | "REVIEW" | "EXCLUDED";
  currency: string;
  paidAmount: string;
  netPremiumPaid: string | null;
  eligibleAmount: string | null;
  conversionRate: string | null;
  conversionDate: string | null;
  reason: string | null;
  evidence: Record<string, unknown>;
};
export type BonusProjection = {
  baseAmount: string;
  bonusRate: number | null;
  bonusAmount: string | null;
  status: "READY" | "REVIEW";
  reviewReasons: string[];
  eligibilityOutcome?: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_EVIDENCE";
  items: BonusProjectionItem[];
};

function n(value: unknown) { return Number(value ?? 0); }

function eligibilityEvidence(json: string | null, required: string[]) {
  if (!json) return { missing: required, data: {} as Record<string, unknown> };
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const numericKeys = new Set(["growth", "growthVs2025", "lossRatio", "persistency", "firstYearCancellationRate"]);
    const booleanKeys = new Set(["productEligible", "newBusiness", "fleetUnder50", "autoExclusionsReviewed", "facultativeInsuranceReviewed", "directedBusinessReviewed", "frontingReviewed", "damageExclusionsReviewed", "lossAndSpecialExclusionsReviewed", "individualNewPolicy", "firstYear", "newInsureds", "notCollective", "collectivePolicy", "individualPolicy", "plenitExclusionsReviewed", "specialConditionsReviewed", "firstReceiptPaid", "minimumPremiumAndTerm", "exclusionsReviewed", "reinsuranceReviewed"]);
    const missing = required.filter((key) => data[key] === undefined || data[key] === null || data[key] === "" || (numericKeys.has(key) && typeof data[key] !== "number") || (booleanKeys.has(key) && typeof data[key] !== "boolean"));
    return { missing, data };
  } catch {
    return { missing: required, data: {} as Record<string, unknown> };
  }
}

export async function calculateBonusProjection(db: TenantDb, organizationId: string, rule: ProgramRule, input: BonusProjectionInput): Promise<BonusProjection> {
  const periodNumber = rule.period === "QUARTERLY" ? input.periodNumber : 1;
  const dateWhere = bonusPaymentWindow(rule, input.year, periodNumber);
  const payments = await db.payment.findMany({
    where: { organizationId, status: "POSTED", paidDate: dateWhere, policy: { organizationId }, receipt: { status: { not: "CANCELLED" } } },
    include: {
      receipt: { select: { id: true, amount: true, currency: true, endorsementId: true, vatAmount: true, issuanceExpenseAmount: true, surchargeAmount: true, discountAmount: true, premiumBreakdownByUnit: true } },
      policy: { include: { client: { select: { portfolioOwnerId: true } }, insurer: { select: { name: true } }, insuredAssets: { select: { id: true } } } },
    },
    orderBy: [{ paidDate: "asc" }, { id: "asc" }],
  });
  const rates = await loadCurrencyRates(db, organizationId, dateWhere.lt);
  const candidates = payments.filter((payment) => {
    const policy = payment.policy;
    if (!rule.policyTypes.includes(policy.policyType)) return false;
    if (rule.insurers.length && !rule.insurers.some((name) => normalizedInsurerName(policy.insurer.name).includes(name))) return false;
    if (["GMM_AXA_INDIV_2026", "GMM_AXA_GROUP_2026", "LIFE_AXA_INDIV_2026", "LIFE_AXA_GROUP_2026"].includes(rule.key) && policy.bonusEligibilityJson) {
      try {
        const variant = (JSON.parse(policy.bonusEligibilityJson) as Record<string, unknown>).programKey;
        if (typeof variant === "string" && variant !== rule.key) return false;
      } catch { /* malformed evidence remains in the review queue */ }
    }
    if (rule.accumulation === "FIRST_POLICY_YEAR") {
      const firstYearEnd = new Date(policy.startDate);
      firstYearEnd.setUTCFullYear(firstYearEnd.getUTCFullYear() + 1);
      if (payment.paidDate < policy.startDate || payment.paidDate >= firstYearEnd) return false;
    }
    return (policy.bonusSellerId ?? policy.client.portfolioOwnerId) === input.sellerId;
  });
  const policyIds = [...new Set(candidates.map((payment) => payment.policyId))];
  const receiptRows = policyIds.length ? await db.receipt.findMany({
    where: { organizationId, policyId: { in: policyIds } },
    select: {
      id: true, policyId: true, receiptSequence: true, endorsementId: true, amount: true, status: true, cancelledAt: true, cancellationReason: true,
      payments: { where: { organizationId, status: "POSTED" }, select: { id: true } },
    },
  }) : [];
  const endorsementIds = [...new Set(candidates.map((payment) => payment.receipt.endorsementId).filter((id): id is string => Boolean(id)))];
  const endorsementRows = endorsementIds.length ? await db.policyEndorsement.findMany({
    where: { organizationId, id: { in: endorsementIds } },
    select: { id: true, amount: true },
  }) : [];
  const baseReceiptsByPolicy = new Map<string, typeof receiptRows>();
  const endorsementReceipts = new Map<string, typeof receiptRows>();
  for (const row of receiptRows) {
    if (row.endorsementId) endorsementReceipts.set(row.endorsementId, [...(endorsementReceipts.get(row.endorsementId) ?? []), row]);
    else baseReceiptsByPolicy.set(row.policyId, [...(baseReceiptsByPolicy.get(row.policyId) ?? []), row]);
  }
  const policyPremiumById = new Map(candidates.map((payment) => [payment.policyId, n(payment.policy.premiumAmount)]));
  const policyReconciliation = new Map(policyIds.map((policyId) => {
    const rows = (baseReceiptsByPolicy.get(policyId) ?? []).map((row) => ({
      id: row.id,
      amount: n(row.amount),
      status: row.status,
      receiptSequence: row.receiptSequence,
      endorsementId: row.endorsementId,
      cancelledAt: row.cancelledAt,
      cancellationReason: row.cancellationReason,
      postedPaymentCount: row.payments.length,
    }));
    return [policyId, reconcilePolicyReceiptPremium(policyPremiumById.get(policyId) ?? 0, rows)] as const;
  }));
  const endorsementReconciliation = new Map(endorsementRows.map((endorsement) => [endorsement.id, reconcileEndorsementReceiptPremium(n(endorsement.amount), (endorsementReceipts.get(endorsement.id) ?? []).map((row) => ({ amount: n(row.amount), status: row.status })))]));
  const byReceipt = new Map<string, typeof candidates>();
  for (const payment of candidates) byReceipt.set(payment.receiptId, [...(byReceipt.get(payment.receiptId) ?? []), payment]);
  const items: BonusProjectionItem[] = [];
  const reviewReasons = new Set<string>();

  for (const [, receiptPayments] of byReceipt) {
    const receipt = receiptPayments[0].receipt;
    const totalPosted = receiptPayments.reduce((sum, payment) => sum + n(payment.amount), 0);
    const breakdown = Array.isArray(receipt.premiumBreakdownByUnit)
      ? receipt.premiumBreakdownByUnit.flatMap((row) => row && typeof row === "object" && !Array.isArray(row)
        ? [{ ...(row as Record<string, unknown>), totalPremium: n((row as Record<string, unknown>).totalPremium) } as { insuredAssetId: string; totalPremium: number; vatAmount: number; issuanceExpenseAmount: number; surchargeAmount: number; discountAmount: number }]
        : [])
      : [];
    const calculatedNet = deriveReceiptNetPremium({
      amount: n(receipt.amount),
      vatAmount: receipt.vatAmount === null ? null : n(receipt.vatAmount),
      issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : n(receipt.issuanceExpenseAmount),
      surchargeAmount: receipt.surchargeAmount === null ? null : n(receipt.surchargeAmount),
      discountAmount: receipt.discountAmount === null ? null : n(receipt.discountAmount),
      premiumBreakdownByUnit: breakdown.length ? breakdown : null,
    });
    const netPremiumFromUnitBreakdown = calculatedNet !== null && breakdown.length > 0;
    const currencyMismatch = receiptPayments.some((payment) => payment.currency.toUpperCase() !== receipt.currency.toUpperCase());
    const relevantReconciliation = receipt.endorsementId
      ? endorsementReconciliation.get(receipt.endorsementId)
      : policyReconciliation.get(receiptPayments[0].policyId);
    const reconciliationEvidence = relevantReconciliation ? {
      expectedTotal: relevantReconciliation.expectedTotal.toFixed(2),
      activeReceiptTotal: relevantReconciliation.receiptTotal.toFixed(2),
      difference: relevantReconciliation.difference.toFixed(2),
      cancelledReceiptOffset: "cancellationOffset" in relevantReconciliation && typeof relevantReconciliation.cancellationOffset === "number" ? relevantReconciliation.cancellationOffset.toFixed(2) : "0.00",
      cancelledReceiptIds: "cancelledReceiptIds" in relevantReconciliation ? relevantReconciliation.cancelledReceiptIds : [],
    } : null;
    const overpaid = totalPosted > n(receipt.amount) + 0.01;
    const totalNetPaid = calculatedNet === null || currencyMismatch || overpaid ? null : allocatePaidNetPremium(calculatedNet, n(receipt.amount), totalPosted);
    const scale = totalPosted > 0 && totalNetPaid !== null ? totalNetPaid / totalPosted : 0;
    let allocatedSoFar = 0;

    for (const [paymentIndex, payment] of receiptPayments.entries()) {
      const policy = payment.policy;
      const policyRiskDetails = policy.riskDetails && typeof policy.riskDetails === "object" && !Array.isArray(policy.riskDetails) ? policy.riskDetails as Record<string, unknown> : {};
      const policyRiskData = policyRiskDetails.data && typeof policyRiskDetails.data === "object" && !Array.isArray(policyRiskDetails.data) ? policyRiskDetails.data as Record<string, unknown> : {};
      const autoVehicleCount = policy.insuredAssets.length || countInsuredVehicles(policyRiskData.vehicles);
      const paid = n(payment.amount);
      const netPaid = totalNetPaid === null ? null : paymentIndex === receiptPayments.length - 1
        ? Math.round((totalNetPaid - allocatedSoFar) * 100) / 100
        : Math.round(paid * scale * 100) / 100;
      if (netPaid !== null) allocatedSoFar += netPaid;
      const evidenceCheck = eligibilityEvidence(policy.bonusEligibilityJson, rule.requiresEvidence);
      const reasons: string[] = [];
      const evidence = evidenceCheck.data;
      const disqualifyingFlags = ["productEligible", "fleetUnder50", "individualNewPolicy", "firstYear", "notCollective", "individualPolicy"];
      const excluded = disqualifyingFlags.some((key) => evidence[key] === false);
      if (excluded) reasons.push("La evidencia registrada indica que la póliza no cumple el criterio de elegibilidad.");
      const pendingReviewKeys = rule.requiresEvidence.filter((key) => evidence[key] === false && !disqualifyingFlags.includes(key));
      if (pendingReviewKeys.length) reasons.push(`Falta completar revisión de evidencia: ${pendingReviewKeys.join(", ")}.`);
      const maxLossRatio = rule.key === "GMM_AXA_GROUP_2026" ? 0.65 : rule.key === "LIFE_AXA_GROUP_2026" ? 0.68 : rule.key === "CONVENTION_KOI_2026" ? 0.65 : null;
      if (typeof evidence.lossRatio === "number" && maxLossRatio !== null && evidence.lossRatio > maxLossRatio) {
        reasons.push(`Siniestralidad ${evidence.lossRatio} excede el máximo ${maxLossRatio}.`);
      }
      if (rule.key === "LIFE_AXA_GROUP_2026" && typeof evidence.growth === "number" && evidence.growth < 0.15) {
        reasons.push("El crecimiento no alcanza el mínimo de 15%.");
      }
      if (rule.key === "CONVENTION_KOI_2026" && typeof evidence.growthVs2025 === "number" && evidence.growthVs2025 < 0.1) {
        reasons.push("El crecimiento contra 2025 no alcanza el mínimo de 10%.");
      }
      if (rule.key === "LIFE_ALLIANZ_INDIV_2026" && typeof evidence.firstYearCancellationRate === "number" && evidence.firstYearCancellationRate >= 0.2) {
        reasons.push("La cancelación del primer año debe ser menor a 20%.");
      }
      if (rule.key === "LIFE_AXA_INDIV_2026" && typeof evidence.persistency === "number" && evidence.persistency < 0.75) {
        reasons.push("La persistencia registrada no alcanza el mínimo de 75%.");
      }
      if (!policy.bonusSellerId && evidence.sellerAttributionConfirmed !== true) reasons.push("Atribución provisional: confirmar vendedor histórico con sellerAttributionConfirmed=true.");
      if (calculatedNet === null) reasons.push("Falta el desglose completo del recibo para calcular prima neta.");
      if (netPremiumFromUnitBreakdown) reasons.push("PNP derivada del desglose por unidad; validar contra el recibo individual antes de aprobar.");
      if (overpaid) reasons.push("Los pagos POSTED exceden el importe del recibo; revisar la aplicación antes de prorratear.");
      let conversion: ReturnType<typeof convertMoneyValue> | null = null;
      if (netPaid !== null) {
        try { conversion = convertMoneyValue(netPaid, payment.currency || receipt.currency, payment.paidDate, rates); }
        catch { reasons.push(`Moneda inválida para conversión: ${payment.currency}.`); }
      }
      if (currencyMismatch) reasons.push("La moneda del pago no coincide con la moneda del recibo; revisar aplicación.");
      if (!relevantReconciliation || relevantReconciliation.status !== "RECONCILED") reasons.push(`La prima no concilia con los recibos vigentes (diferencia ${relevantReconciliation?.difference.toFixed(2) ?? "desconocida"} ${receipt.currency}); revisar antes del bono.`);
      if (conversion?.conversionStatus === "NO_RATE") reasons.push(`Falta tipo de cambio ${payment.currency} a MXN para ${payment.paidDate.toISOString().slice(0, 10)}.`);
      if (evidenceCheck.missing.length) reasons.push(`Falta evidencia: ${evidenceCheck.missing.join(", ")}.`);
      const amount = conversion?.amountMxn === null || !conversion ? null : Number(conversion.amountMxn);
      const status = excluded || reasons.some((reason) => reason.includes("excede el máximo") || reason.includes("no alcanza el mínimo") || reason.includes("menor a 20%")) ? "EXCLUDED" : reasons.length ? "REVIEW" : "INCLUDED";
      if (status === "REVIEW") reasons.forEach((reason) => reviewReasons.add(reason));
      items.push({
        paymentId: payment.id, receiptId: receipt.id, policyId: policy.id, status,
        currency: payment.currency || receipt.currency, paidAmount: paid.toFixed(2),
        netPremiumPaid: netPaid?.toFixed(2) ?? null, eligibleAmount: amount?.toFixed(2) ?? null,
        conversionRate: conversion?.conversionRate ?? null, conversionDate: conversion?.conversionDate ?? null,
        reason: reasons.join(" ") || null,
        evidence: {
          paidDate: payment.paidDate.toISOString(),
          insurer: policy.insurer.name,
          policyType: policy.policyType,
          sellerId: policy.bonusSellerId ?? policy.client.portfolioOwnerId,
          netPremiumSource: netPremiumFromUnitBreakdown ? "UNIT_BREAKDOWN_REVIEW" : calculatedNet === null ? null : "RECEIPT_COMPONENTS",
          policyStatus: policy.status,
          ...(policy.policyType === "AUTO" ? { autoPolicyMode: autoPolicyModeForCount(autoVehicleCount), insuredVehicleCount: autoVehicleCount } : {}),
          premiumReconciliation: reconciliationEvidence,
          ruleEvidence: evidenceCheck.data,
        },
      });
    }
  }

  if (rule.key === "LIFE_AXA_INDIV_2026") {
    const totals = new Map<string, number>();
    for (const item of items) if (item.status === "INCLUDED" && item.eligibleAmount) totals.set(item.policyId, (totals.get(item.policyId) ?? 0) + Number(item.eligibleAmount));
    const belowMinimum = new Set([...totals].filter(([, amount]) => amount < 16000).map(([policyId]) => policyId));
    for (const item of items) if (belowMinimum.has(item.policyId)) {
      item.status = "EXCLUDED";
      item.reason = "Prima neta del primer año menor al mínimo de $16,000 por póliza.";
    }
  }

  if (rule.key.startsWith("DAMAGE_") && items.some((item) => item.status !== "EXCLUDED")) {
    const portfolioLossRatio = input.damagePortfolioLossRatio;
    const portfolioStatus = damagePortfolioLossRatioStatus(portfolioLossRatio);
    for (const item of items) item.evidence = { ...item.evidence, damagePortfolioLossRatio: portfolioLossRatio ?? null, damagePortfolioLossRatioScope: "SELLER_TOTAL_DAMAGE_PORTFOLIO_FOR_CLOSE_PERIOD" };
    if (portfolioStatus === "MISSING") {
      reviewReasons.add("Falta la siniestralidad de la cartera total de Daños del vendedor para este cierre.");
    } else if (portfolioStatus === "EXCLUDED") {
      for (const item of items) {
        item.status = "EXCLUDED";
        item.reason = [item.reason, `La siniestralidad de la cartera total de Daños es ${(portfolioLossRatio! * 100).toFixed(6)}%, superior al máximo de 50%.`].filter(Boolean).join(" ");
      }
      reviewReasons.clear();
    }
  }

  const base = items.reduce((sum, item) => sum + (item.status === "INCLUDED" && item.eligibleAmount ? Number(item.eligibleAmount) : 0), 0);
  const tier = selectBonusTier(base, rule.tiers);
  const bonusRate = rule.eligibilityOnly ? null : tier?.rate ?? null;
  const bonusAmount = rule.eligibilityOnly || bonusRate === null ? null : (base * bonusRate).toFixed(2);
  let eligibilityOutcome: BonusProjection["eligibilityOutcome"];
  if (rule.eligibilityOnly) {
    eligibilityOutcome = reviewReasons.size ? "PENDING_EVIDENCE" : base >= 4200000 ? "ELIGIBLE" : "NOT_ELIGIBLE";
  }
  return { baseAmount: base.toFixed(2), bonusRate, bonusAmount, status: reviewReasons.size ? "REVIEW" : "READY", reviewReasons: [...reviewReasons], eligibilityOutcome, items };
}

export function asJson(value: unknown) { return JSON.stringify(value); }
export function decimalOrNull(value: string | null) { return value === null ? null : new Prisma.Decimal(value); }
