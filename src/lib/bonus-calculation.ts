import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "@/lib/organization-context";
import { allocatePaidNetPremium } from "@/lib/premium-breakdown";
import { convertMoneyValue, loadCurrencyRates } from "@/lib/currency-rates";
import { damagePortfolioLossRatioStatus, normalizedInsurerName, selectBonusTier, type BonusProgram as ProgramRule } from "@/lib/bonus-rules";

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

function utcDate(year: number, month: number, day: number) { return new Date(Date.UTC(year, month, day)); }
function quarterStart(year: number, quarter: number) { return utcDate(year, (quarter - 1) * 3, 1); }
function quarterEnd(year: number, quarter: number) { return utcDate(year, quarter * 3, 1); }
function yearEnd(year: number) { return utcDate(year + 1, 0, 1); }
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

function paymentWindow(rule: ProgramRule, year: number, quarter: number) {
  if (rule.period === "QUARTERLY" && rule.accumulation === "YEAR_TO_DATE") return { gte: utcDate(year, 0, 1), lt: quarterEnd(year, quarter) };
  if (rule.period === "QUARTERLY") return { gte: quarterStart(year, quarter), lt: quarterEnd(year, quarter + 1) };
  return { gte: utcDate(year, 0, 1), lt: yearEnd(year) };
}

export async function calculateBonusProjection(db: TenantDb, organizationId: string, rule: ProgramRule, input: BonusProjectionInput): Promise<BonusProjection> {
  const periodNumber = rule.period === "QUARTERLY" ? input.periodNumber : 1;
  const dateWhere = paymentWindow(rule, input.year, periodNumber);
  const payments = await db.payment.findMany({
    where: { organizationId, status: "POSTED", paidDate: dateWhere, policy: { organizationId } },
    include: {
      receipt: { select: { id: true, amount: true, currency: true, netPremiumAmount: true, vatAmount: true, issuanceExpenseAmount: true, surchargeAmount: true, discountAmount: true } },
      policy: { include: { client: { select: { portfolioOwnerId: true } }, insurer: { select: { name: true } } } },
    },
    orderBy: [{ paidDate: "asc" }, { id: "asc" }],
  });
  const rates = await loadCurrencyRates(db, organizationId, quarterEnd(input.year, periodNumber));
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
  const byReceipt = new Map<string, typeof candidates>();
  for (const payment of candidates) byReceipt.set(payment.receiptId, [...(byReceipt.get(payment.receiptId) ?? []), payment]);
  const items: BonusProjectionItem[] = [];
  const reviewReasons = new Set<string>();

  for (const [, receiptPayments] of byReceipt) {
    const receipt = receiptPayments[0].receipt;
    const totalPosted = receiptPayments.reduce((sum, payment) => sum + n(payment.amount), 0);
    const net = receipt.netPremiumAmount === null
      ? null
      : n(receipt.netPremiumAmount);
    const calculatedNet = net ?? (receipt.vatAmount !== null && receipt.issuanceExpenseAmount !== null && receipt.surchargeAmount !== null && receipt.discountAmount !== null
      ? n(receipt.amount) - n(receipt.vatAmount) - n(receipt.issuanceExpenseAmount) - n(receipt.surchargeAmount) + n(receipt.discountAmount)
      : null);
    const currencyMismatch = receiptPayments.some((payment) => payment.currency.toUpperCase() !== receipt.currency.toUpperCase());
    const totalNetPaid = calculatedNet === null || currencyMismatch ? null : allocatePaidNetPremium(calculatedNet, n(receipt.amount), totalPosted);
    const scale = totalPosted > 0 && totalNetPaid !== null ? totalNetPaid / totalPosted : 0;
    let allocatedSoFar = 0;

    for (const [paymentIndex, payment] of receiptPayments.entries()) {
      const policy = payment.policy;
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
      let conversion: ReturnType<typeof convertMoneyValue> | null = null;
      if (netPaid !== null) {
        try { conversion = convertMoneyValue(netPaid, payment.currency || receipt.currency, payment.paidDate, rates); }
        catch { reasons.push(`Moneda inválida para conversión: ${payment.currency}.`); }
      }
      if (currencyMismatch) reasons.push("La moneda del pago no coincide con la moneda del recibo; revisar aplicación.");
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
        evidence: { paidDate: payment.paidDate.toISOString(), insurer: policy.insurer.name, policyType: policy.policyType, sellerId: policy.bonusSellerId ?? policy.client.portfolioOwnerId, ruleEvidence: evidenceCheck.data },
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
        if (item.status !== "INCLUDED") continue;
        item.status = "EXCLUDED";
        item.reason = [item.reason, `La siniestralidad de la cartera total de Daños es ${(portfolioLossRatio! * 100).toFixed(6)}%, superior al máximo de 50%.`].filter(Boolean).join(" ");
      }
    }
  }

  const base = items.reduce((sum, item) => sum + (item.status === "INCLUDED" && item.eligibleAmount ? Number(item.eligibleAmount) : 0), 0);
  const tier = selectBonusTier(base, rule.tiers);
  const bonusRate = rule.eligibilityOnly ? null : tier?.rate ?? null;
  if (rule.key === "AUTO_2026" && base > 9999999) reviewReasons.add("La prima acumulada supera el límite superior de $9,999,999 del cuaderno; se requiere aclaración.");
  const bonusAmount = rule.eligibilityOnly || bonusRate === null ? null : (base * bonusRate).toFixed(2);
  let eligibilityOutcome: BonusProjection["eligibilityOutcome"];
  if (rule.eligibilityOnly) {
    eligibilityOutcome = reviewReasons.size ? "PENDING_EVIDENCE" : base >= 4200000 ? "ELIGIBLE" : "NOT_ELIGIBLE";
  }
  return { baseAmount: base.toFixed(2), bonusRate, bonusAmount, status: reviewReasons.size ? "REVIEW" : "READY", reviewReasons: [...reviewReasons], eligibilityOutcome, items };
}

export function asJson(value: unknown) { return JSON.stringify(value); }
export function decimalOrNull(value: string | null) { return value === null ? null : new Prisma.Decimal(value); }
