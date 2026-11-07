import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import type { PolicyFormValues } from "@/lib/validations";
import { compareRenewalPolicies } from "@/lib/policy-renewal-comparison";
import { policyRiskDetailsSchema } from "@/lib/policy-risk-details";
import { validateRenewalLink } from "@/lib/policy-renewal-link.logic";

export type RenewalDraftChange = {
  label: string;
  before: string;
  after: string;
};

type Draft = Pick<PolicyFormValues,
  "clientId" | "insurerId" | "policyType" | "policyNumber" |
  "startDate" | "endDate" | "premiumAmount" | "currency" |
  "paymentFrequency" | "riskDetails" | "premiumIssuanceExpenseAmount" |
  "premiumSurchargeAmount" | "premiumDiscountAmount"
>;

function dateInput(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(NaN);
}

function dateKey(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
}

function valueText(value: string | number | null | undefined): string {
  return value === "" || value === null || value === undefined ? "Sin dato" : String(value);
}

function identitySet(value: unknown): { type: string; values: string[]; total: number; incomplete: boolean } | null {
  const result = policyRiskDetailsSchema.safeParse(value);
  if (!result.success) return null;
  const risk = result.data;
  if (risk.policyType === "AUTO") {
    const ids = risk.data.vehicles.map((vehicle) => vehicle.vin.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
    return { type: "VIN de vehículos", values: ids.sort(), total: risk.data.vehicles.length, incomplete: ids.length !== risk.data.vehicles.length };
  }
  if (risk.policyType === "GMM" || risk.policyType === "VIDA" || risk.policyType === "ACCIDENTES") {
    const ids = risk.data.insuredPeople.map((person) => person.fullName.trim().toUpperCase()).filter(Boolean);
    return { type: "Personas aseguradas", values: ids.sort(), total: risk.data.insuredPeople.length, incomplete: ids.length !== risk.data.insuredPeople.length };
  }
  if (risk.policyType === "HOGAR" || risk.policyType === "EMPRESARIAL" || risk.policyType === "DANOS") {
    const ids = risk.data.locations.map((location) => location.address.trim().toUpperCase()).filter(Boolean);
    return { type: "Ubicaciones aseguradas", values: ids.sort(), total: risk.data.locations.length, incomplete: ids.length !== risk.data.locations.length };
  }
  return null;
}

export function getRenewalDraftFingerprint(sourceId: string, draft: Draft): string {
  return JSON.stringify({
    sourceId,
    clientId: draft.clientId,
    insurerId: draft.insurerId,
    policyType: draft.policyType,
    policyNumber: draft.policyNumber,
    startDate: draft.startDate,
    endDate: draft.endDate,
    premiumAmount: draft.premiumAmount,
    currency: draft.currency,
    paymentFrequency: draft.paymentFrequency,
    riskDetails: draft.riskDetails,
    premiumIssuanceExpenseAmount: draft.premiumIssuanceExpenseAmount,
    premiumSurchargeAmount: draft.premiumSurchargeAmount,
    premiumDiscountAmount: draft.premiumDiscountAmount,
  });
}

export function buildRenewalDraftReview(source: PolicyRenewalSource, draft: Draft): {
  issue: string | null;
  changes: RenewalDraftChange[];
  warnings: string[];
} {
  const linkIssue = validateRenewalLink(source, {
    clientId: draft.clientId,
    insurerId: draft.insurerId,
    policyType: draft.policyType,
    startDate: dateInput(draft.startDate),
    endDate: dateInput(draft.endDate),
  });
  const issue = source.status === "RENEWED" || source.hasRenewal
    ? "La póliza de origen ya tiene una renovación vinculada. Selecciona la vigencia correcta."
    : linkIssue;

  const changes: RenewalDraftChange[] = [];
  const add = (label: string, before: string | number | null | undefined, after: string | number | null | undefined) => {
    if (String(before ?? "") !== String(after ?? "")) {
      changes.push({ label, before: valueText(before), after: valueText(after) });
    }
  };

  add("Número de póliza", source.policyNumber, draft.policyNumber);
  add("Inicio de vigencia", dateKey(source.startDate), draft.startDate);
  add("Fin de vigencia", dateKey(source.endDate), draft.endDate);
  add("Prima total", source.premiumAmount, draft.premiumAmount);
  add("Moneda", source.currency, draft.currency);
  add("Frecuencia de pago", source.paymentFrequency, draft.paymentFrequency);

  const comparison = compareRenewalPolicies({
    policyType: source.policyType,
    premiumAmount: source.premiumAmount,
    currency: source.currency,
    riskDetails: source.riskDetails ?? null,
  }, {
    policyType: draft.policyType,
    premiumAmount: Number(draft.premiumAmount) || null,
    currency: draft.currency,
    riskDetails: draft.riskDetails ?? null,
  });

  for (const difference of comparison.differences) {
    changes.push({
      label: difference.label,
      before: difference.oldValue ?? "Sin dato",
      after: difference.newValue ?? "Sin dato",
    });
  }

  const warnings: string[] = [];
  const beforeIdentity = identitySet(source.riskDetails);
  const nextIdentity = identitySet(draft.riskDetails);
  if (beforeIdentity && nextIdentity && beforeIdentity.type === nextIdentity.type) {
    if (JSON.stringify(beforeIdentity.values) !== JSON.stringify(nextIdentity.values)
      || beforeIdentity.total !== nextIdentity.total) {
      changes.push({
        label: `${beforeIdentity.type} (verifica cada elemento)`,
        before: `${beforeIdentity.total} registrados`,
        after: `${nextIdentity.total} registrados; identidad modificada`,
      });
    }
    if (beforeIdentity.incomplete || nextIdentity.incomplete) {
      warnings.push("Hay vehículos, asegurados o ubicaciones sin identificación completa. Revisa el documento original.");
    }
  } else {
    warnings.push("No fue posible comparar todos los datos estructurados del riesgo. Compruébalos con la nueva póliza.");
  }
  if (source.currency !== draft.currency) {
    warnings.push("Las monedas son distintas; no calcules diferencias de primas como si fueran la misma moneda.");
  }
  if (draft.premiumIssuanceExpenseAmount === "" || draft.premiumSurchargeAmount === "" || draft.premiumDiscountAmount === "") {
    warnings.push("El desglose de prima tiene importes pendientes. Revisa IVA, gastos, recargos y descuentos.");
  }

  return { issue, changes, warnings };
}
