import { addYears } from "date-fns";
import { formatDateInput } from "@/lib/form-utils";
import type { PolicyFormValues } from "@/lib/validations";

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
  beneficiaryInfo: string | null;
  notes: string | null;
};

export function buildRenewalPolicyDefaults(source: PolicyRenewalSource): Partial<PolicyFormValues> {
  return {
    clientId: source.clientId,
    insurerId: source.insurerId,
    policyType: source.policyType,
    startDate: formatDateInput(source.endDate),
    endDate: formatDateInput(addYears(source.endDate, 1)),
    premiumAmount: source.premiumAmount,
    currency: source.currency,
    paymentFrequency: source.paymentFrequency,
    paymentPlan: source.paymentPlan ?? "",
    insuredObject: source.insuredObject ?? "",
    beneficiaryInfo: source.beneficiaryInfo ?? "",
    notes: source.notes ?? "",
    renewedFromPolicyId: source.id,
  };
}
