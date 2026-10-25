// Pure business logic for commissions - no "use server"
// This file can be imported in tests without Next.js context

import { businessAddDays, businessToday } from "@/lib/business-dates";
import { deriveNetPremium } from "@/lib/premium-breakdown";

export type CommissionRule = {
  id: string;
  policyType: string;
  productPlan: string;
  policyMode: string;
  unitClass: string;
  paymentFrequency: string;
  rate: number;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  evidence: string;
  source?: "INSURER_RULE" | "POLICY_OVERRIDE";
};

export function parseCommissionRules(value: unknown): CommissionRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.policyType !== "string" || typeof row.rate !== "number" || !Number.isFinite(row.rate) || row.rate <= 0 || row.rate > 100) return [];
    const text = (key: string, fallback = "*") => typeof row[key] === "string" ? row[key] as string : fallback;
    return [{
      id: row.id,
      policyType: row.policyType,
      productPlan: text("productPlan"),
      policyMode: text("policyMode"),
      unitClass: text("unitClass"),
      paymentFrequency: text("paymentFrequency"),
      rate: row.rate,
      validFrom: text("validFrom", "9999-12-31"),
      validTo: row.validTo === null || typeof row.validTo === "string" ? row.validTo as string | null : null,
      active: row.active === true,
      evidence: text("evidence", ""),
      source: "INSURER_RULE",
    }];
  });
}

export type CommissionDimensions = Pick<CommissionRule, "policyType" | "productPlan" | "policyMode" | "unitClass" | "paymentFrequency">;

export type CommissionPremiumComponents = {
  totalPremium: number;
  iva: number;
  issuanceExpense: number;
  installmentSurcharge: number;
  visibleDiscounts: number;
};

export type CommissionEstimate = {
  status: "CALCULATED" | "REVIEW";
  reason?: string;
  amount?: number;
  rate?: number;
  netPremium?: number;
  commissionableBase?: number;
  rule?: CommissionRule;
};

const WILDCARD = "*";

export function resolveCommissionRule(
  rules: CommissionRule[],
  dimensions: CommissionDimensions,
  asOf: Date,
): { rule: CommissionRule | null; ambiguous: boolean } {
  const date = asOf.toISOString().slice(0, 10);
  const keys = ["policyType", "productPlan", "policyMode", "unitClass", "paymentFrequency"] as const;
  const matches = rules.filter((rule) => rule.active && rule.validFrom <= date && (!rule.validTo || rule.validTo >= date)
    && keys.every((key) => rule[key] === WILDCARD || rule[key] === dimensions[key]));
  if (!matches.length) return { rule: null, ambiguous: false };
  const specificity = (rule: CommissionRule) => keys.reduce((score, key) => score + Number(rule[key] !== WILDCARD), 0);
  const best = Math.max(...matches.map(specificity));
  const selected = matches.filter((rule) => specificity(rule) === best);
  return selected.length === 1 ? { rule: selected[0]!, ambiguous: false } : { rule: null, ambiguous: true };
}

export function calculateCommissionEstimate(
  components: CommissionPremiumComponents | null,
  rules: CommissionRule[],
  dimensions: CommissionDimensions,
  asOf: Date,
  policyRateOverride?: number | null,
): CommissionEstimate {
  if (!components || [components.totalPremium, components.iva, components.issuanceExpense, components.visibleDiscounts]
    .some((amount) => !Number.isFinite(amount) || amount < 0)
    || !Number.isFinite(components.installmentSurcharge)) {
    return { status: "REVIEW", reason: "Completa prima total, IVA, gastos de expedición, recargo fraccionado y descuentos visibles." };
  }
  const overrideRule: CommissionRule | null = policyRateOverride === null || policyRateOverride === undefined ? null : {
    id: "POLICY_RATE_OVERRIDE",
    ...dimensions,
    rate: policyRateOverride,
    validFrom: "0001-01-01",
    validTo: null,
    active: true,
    evidence: "Porcentaje específico capturado en la póliza.",
    source: "POLICY_OVERRIDE",
  };
  if (overrideRule && (!Number.isFinite(overrideRule.rate) || overrideRule.rate < 0 || overrideRule.rate > 100)) {
    return { status: "REVIEW", reason: "El porcentaje específico de la póliza debe estar entre 0% y 100%." };
  }
  const match = overrideRule ? { rule: overrideRule, ambiguous: false } : resolveCommissionRule(rules, dimensions, asOf);
  if (match.ambiguous) return { status: "REVIEW", reason: "Hay más de una regla con la misma prioridad para esta póliza." };
  if (!match.rule) return { status: "REVIEW", reason: "No hay una regla activa para esta aseguradora, ramo, plan, unidad y frecuencia." };
  if (!match.rule.evidence.trim()) return { status: "REVIEW", reason: "La regla de comisión no tiene evidencia documentada." };
  const netPremium = deriveNetPremium(components.totalPremium, {
    vatAmount: components.iva,
    issuanceExpenseAmount: components.issuanceExpense,
    surchargeAmount: components.installmentSurcharge,
    discountAmount: components.visibleDiscounts,
  });
  if (netPremium === null) return { status: "REVIEW", reason: "La prima neta no se puede derivar; revisa los componentes del recibo." };
  const commissionableBase = netPremium;
  return {
    status: "CALCULATED",
    commissionableBase,
    netPremium: commissionableBase,
    rate: match.rule.rate,
    amount: roundMoney(commissionableBase * match.rule.rate / 100),
    rule: match.rule,
  };
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface CommissionCalculationInput {
  policyId: string;
  clientId: string;
  insurerId: string;
  receiptId?: string;
  premiumAmount: number;
  commissionRate: number;
  receiptDueDate?: Date;
  receiptStatus?: string;
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

export function calculateCommission(
  input: CommissionCalculationInput
): CommissionCalculation {
  const expectedAmount = (input.premiumAmount * input.commissionRate) / 100;

  let status: CommissionCalculation["status"] = "EXPECTED";
  if (input.receiptStatus === "PAID") {
    status = "PENDING";
  }

  return {
    policyId: input.policyId,
    clientId: input.clientId,
    insurerId: input.insurerId,
    receiptId: input.receiptId,
    expectedAmount,
    actualAmount: undefined,
    percentage: input.commissionRate,
    expectedDate: input.receiptDueDate || businessAddDays(businessToday(), 30),
    status,
  };
}

export function getCommissionStatusFromReceipt(
  receiptStatus: string
): CommissionCalculation["status"] {
  switch (receiptStatus) {
    case "PAID":
      return "PENDING";
    case "CANCELLED":
      return "CANCELLED";
    case "PENDING":
    default:
      return "EXPECTED";
  }
}

export function calculateOverdueStatus(
  currentStatus: string,
  expectedDate: Date,
  today: Date
): CommissionCalculation["status"] | null {
  if (currentStatus === "EXPECTED" && expectedDate <= today) {
    return "PENDING";
  }
  if (currentStatus === "PENDING" && expectedDate < today) {
    return "OVERDUE";
  }
  return null;
}

export interface CommissionStats {
  totalExpected: number;
  totalActual: number;
  statusBreakdown: Array<{
    status: string;
    count: number;
    totalExpected: number;
    totalActual: number;
  }>;
}

export function aggregateCommissionStats(
  commissions: Array<{
    status: string;
    expectedAmount: number;
    actualAmount: number | null;
  }>
): CommissionStats {
  const totalExpected = commissions.reduce(
    (sum, c) => sum + (c.expectedAmount || 0),
    0
  );
  const totalActual = commissions.reduce(
    (sum, c) => sum + (c.actualAmount || 0),
    0
  );

  const byStatus = new Map<
    string,
    { count: number; expected: number; actual: number }
  >();

  for (const commission of commissions) {
    const current = byStatus.get(commission.status) || {
      count: 0,
      expected: 0,
      actual: 0,
    };
    current.count++;
    current.expected += commission.expectedAmount || 0;
    current.actual += commission.actualAmount || 0;
    byStatus.set(commission.status, current);
  }

  const statusBreakdown = Array.from(byStatus.entries()).map(
    ([status, data]) => ({
      status,
      count: data.count,
      totalExpected: data.expected,
      totalActual: data.actual,
    })
  );

  return {
    totalExpected,
    totalActual,
    statusBreakdown,
  };
}
