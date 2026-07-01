import type {
  ClientFormValues,
  InsurerFormValues,
  ClaimFormValues,
  QuoteFormValues,
  EndorsementFormValues,
  PolicyFormValues,
  ReceiptFormValues,
  WorkItemFormValues,
} from "@/lib/validations";
import { NO_REFERIDOR_VALUE } from "@/lib/constants";

export function createClientDefaults(values?: Partial<ClientFormValues>): ClientFormValues {
  return {
    fullName: values?.fullName ?? "",
    type: values?.type ?? "PERSON",
    email: values?.email ?? "",
    phone: values?.phone ?? "",
    secondaryPhone: values?.secondaryPhone ?? "",
    rfc: values?.rfc ?? "",
    address: values?.address ?? "",
    preferredContactMethod: values?.preferredContactMethod ?? "",
    referidorId: values?.referidorId ?? NO_REFERIDOR_VALUE,
    notes: values?.notes ?? "",
    status: values?.status ?? "ACTIVE",
  };
}

export function createPolicyDefaults(values?: Partial<PolicyFormValues>): PolicyFormValues {
  const today = new Date().toISOString().split("T")[0];
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const nextYearStr = nextYear.toISOString().split("T")[0];

  return {
    policyNumber: values?.policyNumber ?? "",
    clientId: values?.clientId ?? "",
    insurerId: values?.insurerId ?? "",
    policyType: values?.policyType ?? "AUTO",
    status: values?.status ?? "ACTIVE",
    startDate: values?.startDate ?? today,
    endDate: values?.endDate ?? nextYearStr,
    premiumAmount: values?.premiumAmount ?? 0,
    currency: values?.currency ?? "MXN",
    paymentFrequency: values?.paymentFrequency ?? "ANNUAL",
    paymentPlan: values?.paymentPlan ?? "",
    insuredObject: values?.insuredObject ?? "",
    beneficiaryInfo: values?.beneficiaryInfo ?? "",
    notes: values?.notes ?? "",
  };
}

export function createReceiptDefaults(values?: Partial<ReceiptFormValues>): ReceiptFormValues {
  const today = new Date().toISOString().split("T")[0];
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().split("T")[0];

  return {
    receiptNumber: values?.receiptNumber ?? "",
    policyId: values?.policyId ?? "",
    endorsementId: values?.endorsementId ?? "",
    periodStartDate: values?.periodStartDate ?? today,
    periodEndDate: values?.periodEndDate ?? nextMonthStr,
    dueDate: values?.dueDate ?? nextMonthStr,
    amount: values?.amount ?? 0,
    currency: values?.currency ?? "MXN",
    status: values?.status ?? "PENDING",
    paidDate: values?.paidDate ?? "",
    paymentMethod: values?.paymentMethod ?? "",
    notes: values?.notes ?? "",
  };
}

export function createEndorsementDefaults(values?: Partial<EndorsementFormValues>): EndorsementFormValues {
  const today = new Date().toISOString().split("T")[0];

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
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];

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
  const today = new Date().toISOString().split("T")[0];

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

export function createQuoteDefaults(values?: Partial<QuoteFormValues>): QuoteFormValues {
  const today = new Date().toISOString().split("T")[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];

  return {
    clientId: values?.clientId ?? "",
    insurerId: values?.insurerId ?? "",
    policyType: values?.policyType ?? "AUTO",
    status: values?.status ?? "REQUESTED",
    requestedDate: values?.requestedDate ?? today,
    sentDate: values?.sentDate ?? "",
    validUntil: values?.validUntil ?? nextWeekStr,
    quotedAmount: values?.quotedAmount ?? undefined,
    notes: values?.notes ?? "",
  };
}
