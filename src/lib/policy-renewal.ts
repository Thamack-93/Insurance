import type { PolicyFormValues } from "@/lib/validations";
import type { PolicyRiskDetails } from "@/lib/policy-risk-details";

export type PolicyRenewalSource = {
  id: string;
  policyNumber: string;
  clientId: string;
  clientName: string;
  insurerId: string;
  insurerName: string;
  policyType: PolicyFormValues["policyType"];
  startDate: Date;
  endDate: Date;
  premiumAmount: number;
  currency: PolicyFormValues["currency"];
  paymentFrequency: PolicyFormValues["paymentFrequency"];
  paymentPlan: string | null;
  insuredObject: string | null;
  riskDetails?: PolicyRiskDetails | null;
  beneficiaryInfo: string | null;
  notes: string | null;
};

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addCalendarYear(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const nextYear = year + 1;
  const lastDay = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return [nextYear, String(month).padStart(2, "0"), String(Math.min(day, lastDay)).padStart(2, "0")].join("-");
}

export function buildRenewalPolicyDefaults(source: PolicyRenewalSource): Partial<PolicyFormValues> {
  return {
    clientId: source.clientId,
    insurerId: source.insurerId,
    policyType: source.policyType,
    startDate: toDateKey(source.endDate),
    endDate: addCalendarYear(toDateKey(source.endDate)),
    premiumAmount: source.premiumAmount,
    currency: source.currency,
    paymentFrequency: source.paymentFrequency,
    paymentPlan: source.paymentPlan ?? "",
    insuredObject: source.insuredObject ?? "",
    riskDetails: source.riskDetails ?? undefined,
    beneficiaryInfo: source.beneficiaryInfo ?? "",
    notes: source.notes ?? "",
    renewedFromPolicyId: source.id,
  };
}
