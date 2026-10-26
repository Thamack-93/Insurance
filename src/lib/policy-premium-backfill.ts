import { calculateVatFromGross, deriveNetPremium, roundPremiumMoney, type PremiumBreakdown, type UnitPremiumBreakdown } from "@/lib/premium-breakdown";

export type PolicyPremiumBackfillReceipt = {
  id: string;
  status: string;
  amount: number;
  endorsementId?: string | null;
  vatAmount?: number | null;
  issuanceExpenseAmount?: number | null;
  surchargeAmount?: number | null;
  discountAmount?: number | null;
  premiumBreakdownByUnit?: unknown;
};

export type PolicyPremiumBackfillPolicy = {
  id: string;
  policyNumber: string;
  policyType: string;
  premiumAmount: number;
  premiumVatAmount?: number | null;
  premiumIssuanceExpenseAmount?: number | null;
  premiumSurchargeAmount?: number | null;
  premiumDiscountAmount?: number | null;
  receipts: PolicyPremiumBackfillReceipt[];
};

export type PolicyPremiumBackfillOutcome = {
  policyId: string;
  policyNumber: string;
  status: "CANDIDATE" | "REVIEW" | "ALREADY_COMPLETE";
  reason: string;
  grossAmount: number;
  liveReceiptAmount: number;
  difference: number;
  totals: {
    vatAmount: number;
    issuanceExpenseAmount: number;
    surchargeAmount: number;
    discountAmount: number;
  } | null;
  receiptVatAmount: number | null;
  receiptIds: string[];
};

const COMPONENT_KEYS = ["vatAmount", "issuanceExpenseAmount", "surchargeAmount", "discountAmount"] as const;
const TOLERANCE = 0.011;

function completeBreakdown(receipt: PolicyPremiumBackfillReceipt): PremiumBreakdown | null {
  const rows = receipt.premiumBreakdownByUnit;
  if (Array.isArray(rows) && rows.length > 0) {
    const units = rows as UnitPremiumBreakdown[];
    const ids = units.map((unit) => unit.insuredAssetId);
    if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) return null;
    const unitGross = roundPremiumMoney(units.reduce((sum, unit) => sum + Number(unit.totalPremium), 0));
    if (units.some((unit) => typeof unit.totalPremium !== "number" || !Number.isFinite(unit.totalPremium)
      || COMPONENT_KEYS.some((key) => typeof unit[key] !== "number" || !Number.isFinite(unit[key])))
      || Math.abs(unitGross - roundPremiumMoney(receipt.amount)) > TOLERANCE) return null;
    return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, roundPremiumMoney(units.reduce((sum, unit) => sum + Number(unit[key]), 0))])) as PremiumBreakdown;
  }

  if (COMPONENT_KEYS.some((key) => receipt[key] == null || !Number.isFinite(Number(receipt[key])))) return null;
  return Object.fromEntries(COMPONENT_KEYS.map((key) => [key, roundPremiumMoney(Number(receipt[key]))])) as PremiumBreakdown;
}

function hasExistingBreakdown(policy: PolicyPremiumBackfillPolicy) {
  return [policy.premiumVatAmount, policy.premiumIssuanceExpenseAmount, policy.premiumSurchargeAmount, policy.premiumDiscountAmount]
    .some((value) => value !== null && value !== undefined);
}

export function evaluatePolicyPremiumBackfill(policy: PolicyPremiumBackfillPolicy): PolicyPremiumBackfillOutcome {
  const liveReceipts = policy.receipts.filter((receipt) => !receipt.endorsementId && receipt.status !== "CANCELLED");
  const liveReceiptAmount = roundPremiumMoney(liveReceipts.reduce((sum, receipt) => sum + receipt.amount, 0));
  const difference = roundPremiumMoney(policy.premiumAmount - liveReceiptAmount);
  const ids = liveReceipts.map((receipt) => receipt.id);
  const existing = hasExistingBreakdown(policy);
  if (existing) {
    const complete = [policy.premiumVatAmount, policy.premiumIssuanceExpenseAmount, policy.premiumSurchargeAmount, policy.premiumDiscountAmount]
      .every((value) => value !== null && value !== undefined);
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: complete ? "ALREADY_COMPLETE" : "REVIEW", reason: complete ? "Los cuatro totales de póliza ya están capturados." : "El desglose de póliza está parcialmente capturado; no se sobrescribe.", grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }
  if (!liveReceipts.length) {
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: "REVIEW", reason: "No hay recibos base activos; requiere cotejo con la póliza fuente.", grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }

  const breakdowns = liveReceipts.map(completeBreakdown);
  if (breakdowns.some((breakdown) => breakdown === null)) {
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: "REVIEW", reason: "Hay recibos base sin desglose completo o con desglose por riesgo inválido.", grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }
  if (Math.abs(difference) > TOLERANCE) {
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: "REVIEW", reason: `Los recibos base activos difieren de la prima de póliza por ${difference.toFixed(2)}.`, grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }

  const complete = breakdowns as PremiumBreakdown[];
  const vatAmount = calculateVatFromGross(policy.premiumAmount);
  if (vatAmount === null) {
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: "REVIEW", reason: "No se pudo calcular el IVA a nivel póliza.", grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }
  const totals = {
    vatAmount,
    issuanceExpenseAmount: roundPremiumMoney(complete.reduce((sum, breakdown) => sum + Number(breakdown.issuanceExpenseAmount), 0)),
    surchargeAmount: roundPremiumMoney(complete.reduce((sum, breakdown) => sum + Number(breakdown.surchargeAmount), 0)),
    discountAmount: roundPremiumMoney(complete.reduce((sum, breakdown) => sum + Number(breakdown.discountAmount), 0)),
  };
  if (deriveNetPremium(policy.premiumAmount, totals) === null) {
    return { policyId: policy.id, policyNumber: policy.policyNumber, status: "REVIEW", reason: "Los componentes producen una prima neta inválida.", grossAmount: roundPremiumMoney(policy.premiumAmount), liveReceiptAmount, difference, totals: null, receiptVatAmount: null, receiptIds: ids };
  }
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    status: "CANDIDATE",
    reason: Math.abs(roundPremiumMoney(complete.reduce((sum, breakdown) => sum + Number(breakdown.vatAmount), 0)) - vatAmount) > TOLERANCE
      ? "Desglose completo y prima conciliada; IVA de póliza calculado sobre la prima total, con redondeo independiente de recibos."
      : "Desglose completo y prima de recibos conciliada con la póliza.",
    grossAmount: roundPremiumMoney(policy.premiumAmount),
    liveReceiptAmount,
    difference,
    totals,
    receiptVatAmount: roundPremiumMoney(complete.reduce((sum, breakdown) => sum + Number(breakdown.vatAmount), 0)),
    receiptIds: ids,
  };
}
