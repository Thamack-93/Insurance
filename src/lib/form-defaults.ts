import type {
  ClientFormValues,
  InsurerFormValues,
  ClaimFormValues,
  EndorsementFormValues,
  PolicyFormValues,
  ReceiptFormValues,
  WorkItemFormValues,
} from "@/lib/validations";
import { NO_REFERIDOR_VALUE } from "@/lib/constants";
import { businessAddDays, businessToday } from "@/lib/business-dates";
import { formatDateInput } from "@/lib/form-utils";
import { emptyPolicyRiskDetails } from "@/lib/policy-risk-details";

export function createClientDefaults(values?: Partial<ClientFormValues>): ClientFormValues {
  return {
    fullName: values?.fullName ?? "",
    type: values?.type ?? "PERSON",
    email: values?.email ?? "",
    phone: values?.phone ?? "",
    secondaryPhone: values?.secondaryPhone ?? "",
    rfc: values?.rfc ?? "",
    address: values?.address ?? "",
    birthDate: values?.birthDate ?? "",
    preferredContactMethod: values?.preferredContactMethod ?? "",
    referidorId: values?.referidorId ?? NO_REFERIDOR_VALUE,
    notes: values?.notes ?? "",
    status: values?.status ?? "ACTIVE",
  };
}

export function createPolicyDefaults(values?: Partial<PolicyFormValues>): PolicyFormValues {
  const today = formatDateInput(businessToday());
  const nextYearStr = formatDateInput(businessAddDays(businessToday(), 365));

  return {
    policyNumber: values?.policyNumber ?? "",
    clientId: values?.clientId ?? "",
    insurerId: values?.insurerId ?? "",
    bonusSellerId: values?.bonusSellerId ?? "",
    policyType: values?.policyType ?? "AUTO",
    status: values?.status ?? "ACTIVE",
    startDate: values?.startDate ?? today,
    endDate: values?.endDate ?? nextYearStr,
    premiumAmount: values?.premiumAmount ?? 0,
    commissionRateOverride: values?.commissionRateOverride ?? "",
    currency: values?.currency ?? "MXN",
    paymentFrequency: values?.paymentFrequency ?? "ANNUAL",
    paymentPlan: values?.paymentPlan ?? "",
    insuredObject: values?.insuredObject ?? "",
    riskDetails: values?.riskDetails ?? emptyPolicyRiskDetails(values?.policyType ?? "AUTO"),
    bonusEligibilityJson: values?.bonusEligibilityJson ?? "",
    beneficiaryInfo: values?.beneficiaryInfo ?? "",
    notes: values?.notes ?? "",
    renewedFromPolicyId: values?.renewedFromPolicyId ?? "",
  };
}

export function createReceiptDefaults(values?: Partial<ReceiptFormValues>): ReceiptFormValues {
  const today = formatDateInput(businessToday());
  const nextMonthStr = formatDateInput(businessAddDays(businessToday(), 30));

  return {
    receiptNumber: values?.receiptNumber ?? "",
    policyId: values?.policyId ?? "",
    endorsementId: values?.endorsementId ?? "",
    periodStartDate: values?.periodStartDate ?? today,
    periodEndDate: values?.periodEndDate ?? nextMonthStr,
    dueDate: values?.dueDate ?? nextMonthStr,
    amount: values?.amount ?? 0,
    vatAmount: values?.vatAmount ?? "",
    issuanceExpenseAmount: values?.issuanceExpenseAmount ?? "",
    surchargeAmount: values?.surchargeAmount ?? "",
    discountAmount: values?.discountAmount ?? "",
    premiumBreakdownByUnit: values?.premiumBreakdownByUnit ?? [],
    currency: values?.currency ?? "MXN",
    status: values?.status ?? "PENDING",
    paidDate: values?.paidDate ?? "",
    paymentMethod: values?.paymentMethod ?? "",
    notes: values?.notes ?? "",
  };
}

export function readReceiptPremiumUnits(value: unknown): ReceiptFormValues["premiumBreakdownByUnit"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.insuredAssetId !== "string") return [];
    const number = (key: string) => typeof row[key] === "number" && Number.isFinite(row[key]) ? row[key] as number : "";
    return [{ insuredAssetId: row.insuredAssetId, totalPremium: number("totalPremium"), vatAmount: number("vatAmount"), issuanceExpenseAmount: number("issuanceExpenseAmount"), surchargeAmount: number("surchargeAmount"), discountAmount: number("discountAmount") }];
  });
}

export function createEndorsementDefaults(values?: Partial<EndorsementFormValues>): EndorsementFormValues {
  const today = formatDateInput(businessToday());

  return {
    endorsementNumber: values?.endorsementNumber ?? "",
    policyId: values?.policyId ?? "",
    status: values?.status ?? "ACTIVE",
    startDate: values?.startDate ?? today,
    endDate: values?.endDate ?? today,
    amount: values?.amount ?? 0,
    currency: values?.currency ?? "MXN",
    reference: values?.reference ?? "",
    concept: values?.concept ?? "",
    notes: values?.notes ?? "",
  };
}

export function createWorkItemDefaults(values?: Partial<WorkItemFormValues>): WorkItemFormValues {
  const today = formatDateInput(businessToday());
  const nextWeekStr = formatDateInput(businessAddDays(businessToday(), 7));

  return {
    clientId: values?.clientId ?? "",
    policyId: values?.policyId ?? "",
    insurerId: values?.insurerId ?? "",
    receiptId: values?.receiptId ?? "",
    title: values?.title ?? "",
    description: values?.description ?? "",
    taskType: values?.taskType ?? "GENERAL",
    status: values?.status ?? "OPEN",
    priority: values?.priority ?? "MEDIUM",
    startDate: values?.startDate ?? today,
    dueDate: values?.dueDate ?? nextWeekStr,
    notes: values?.notes ?? "",
  };
}

export function createInsurerDefaults(values?: Partial<InsurerFormValues>): InsurerFormValues {
  return {
    name: values?.name ?? "",
    portalUrl: values?.portalUrl ?? "",
    contactName: values?.contactName ?? "",
    contactEmail: values?.contactEmail ?? "",
    contactPhone: values?.contactPhone ?? "",
    notes: values?.notes ?? "",
    status: values?.status ?? "ACTIVE",
  };
}

export function createClaimDefaults(values?: Partial<ClaimFormValues>): ClaimFormValues {
  const today = formatDateInput(businessToday());

  return {
    folio: values?.folio ?? "",
    clientId: values?.clientId ?? "",
    policyId: values?.policyId ?? "",
    insurerId: values?.insurerId ?? "",
    claimType: values?.claimType ?? "",
    description: values?.description ?? "",
    status: values?.status ?? "OPEN",
    incidentDate: values?.incidentDate ?? today,
    reportedDate: values?.reportedDate ?? today,
    closedDate: values?.closedDate ?? "",
    amountClaimed: values?.amountClaimed ?? undefined,
    amountPaid: values?.amountPaid ?? undefined,
    notes: values?.notes ?? "",
  };
}
