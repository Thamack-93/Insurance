import { policyRiskDetailsSchema } from "@/lib/policy-risk-details";
import { policyTypeLabel } from "@/lib/status";
import { formatCurrencyExact } from "@/lib/money";

export type RenewalComparisonStatus = "UNCHANGED" | "CHANGED" | "ADDED" | "REMOVED" | "MISSING";

export type RenewalComparisonPolicy = {
  insurerName: string | null;
  policyType: string | null;
  premiumAmount: number | null;
  currency: string | null;
  paymentFrequency: string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  riskDetails: unknown;
  legacyText: string | null;
  insuredAssets: ReadonlyArray<{ assetType: string; description: string; serialNumber: string | null; isPrimary: boolean }>;
  insuredParties: ReadonlyArray<{ fullName: string; isPrimary: boolean }>;
};

export type RenewalComparisonEntry = {
  key: string;
  label: string;
  status: RenewalComparisonStatus;
  oldValue: string | null;
  newValue: string | null;
};

export type RenewalComparison = {
  differences: RenewalComparisonEntry[];
  unchanged: RenewalComparisonEntry[];
  counts: Record<RenewalComparisonStatus, number>;
  premiumDifference: { amount: number; absoluteAmount: number; percent: number; currency: string } | null;
  legacyPreviousText: string | null;
};

const riskLabels: Record<string, string> = {
  vehicles: "Vehículo", insuredPeople: "Persona asegurada", beneficiaries: "Beneficiario",
  locations: "Ubicación", attributes: "Dato adicional", make: "Marca", model: "Modelo", year: "Año",
  version: "Versión", vin: "Serie / VIN", plates: "Placas", fullName: "Nombre", birthDate: "Fecha de nacimiento",
  relationship: "Parentesco", percentage: "Porcentaje", plan: "Plan", insuredAmount: "Suma asegurada",
  deductible: "Deducible", coinsurance: "Coaseguro", term: "Plazo", address: "Domicilio", use: "Uso",
  construction: "Construcción", activity: "Actividad", insuredValue: "Valor asegurado", coverageLimit: "Límite de cobertura",
  obligation: "Obligación afianzada", contractNumber: "Contrato", beneficiary: "Beneficiario", bondedAmount: "Monto afianzado",
  territory: "Territorio", operations: "Operaciones", buildingValue: "Valor del edificio", contentsValue: "Valor de contenidos",
  businessInterruptionValue: "Interrupción de negocio", accidentCoverage: "Cobertura de accidentes", category: "Categoría",
  label: "Dato", value: "Valor",
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function dateValue(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function policyTypeValue(value: string | null) {
  return value ? policyTypeLabel(value) : null;
}

function frequencyValue(value: string | null) {
  if (!value) return null;
  const labels: Record<string, string> = { MONTHLY: "Mensual", QUARTERLY: "Trimestral", SEMIANNUAL: "Semestral", ANNUAL: "Anual", SINGLE: "Única", OTHER: "Otra" };
  return labels[value] ?? value;
}

function statusFor(oldValue: string | null, newValue: string | null): RenewalComparisonStatus {
  if (oldValue === null && newValue === null) return "MISSING";
  if (oldValue === null) return "ADDED";
  if (newValue === null) return "REMOVED";
  return oldValue === newValue ? "UNCHANGED" : "CHANGED";
}

function flattenStructured(value: unknown): Map<string, { label: string; value: string }> | null {
  const parsed = policyRiskDetailsSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = new Map<string, { label: string; value: string }>();
  const walk = (node: unknown, path: string[], labelPath: string[]) => {
    if (typeof node === "string") {
      const normalized = node.trim();
      if (normalized) result.set(path.join("."), { label: labelPath.join(" · "), value: normalized });
      return;
    }
    if (Array.isArray(node)) {
      const arrayName = path.at(-1) ?? "";
      const occurrence = new Map<string, number>();
      node.forEach((item, index) => {
        const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
        const identityFields: Record<string, string[]> = {
          vehicles: ["vin", "plates", "make", "model", "year", "version"],
          locations: ["address"],
          insuredPeople: ["fullName", "birthDate"],
          beneficiaries: ["fullName"],
          attributes: ["label"],
        };
        const values = (identityFields[arrayName] ?? []).map((field) => text(record?.[field]));
        const identity = arrayName === "vehicles"
          ? values[0] ?? values[1] ?? values.slice(2).filter(Boolean).join("|")
          : values.find(Boolean) ?? "";
        const baseKey = identity || `#${index}`;
        const duplicateNumber = occurrence.get(baseKey) ?? 0;
        occurrence.set(baseKey, duplicateNumber + 1);
        const stableKey = `${baseKey}:${duplicateNumber}`;
        walk(item, [...path, stableKey], [...labelPath, `${labelPath.at(-1) ?? "Dato"} ${index + 1}`]);
      });
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const label = riskLabels[key] ?? key;
        walk(child, [...path, key], [...labelPath, label]);
      }
    }
  };
  walk(parsed.data.data, [], []);
  return result;
}

function collectionEntries(
  section: "asset" | "party",
  oldItems: RenewalComparisonPolicy["insuredAssets"] | RenewalComparisonPolicy["insuredParties"],
  newItems: RenewalComparisonPolicy["insuredAssets"] | RenewalComparisonPolicy["insuredParties"],
): RenewalComparisonEntry[] {
  const describe = (item: (typeof oldItems)[number]) => "description" in item
    ? [item.assetType, item.description, item.serialNumber ? `Serie ${item.serialNumber}` : null, item.isPrimary ? "Principal" : "Secundario"].filter(Boolean).join(" · ")
    : `${item.fullName}${item.isPrimary ? " · Principal" : " · Secundario"}`;
  const identity = (item: (typeof oldItems)[number]) => "description" in item
    ? `${item.assetType}|${item.description.trim().toLocaleLowerCase()}|${item.serialNumber?.trim().toLocaleLowerCase() ?? ""}`
    : item.fullName.trim().toLocaleLowerCase();
  const oldMap = new Map<string, Array<(typeof oldItems)[number]>>();
  const newMap = new Map<string, Array<(typeof newItems)[number]>>();
  for (const item of oldItems) oldMap.set(identity(item), [...(oldMap.get(identity(item)) ?? []), item]);
  for (const item of newItems) newMap.set(identity(item), [...(newMap.get(identity(item)) ?? []), item]);
  const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  const entries: RenewalComparisonEntry[] = [];
  for (const key of keys) {
    const oldValues = oldMap.get(key) ?? [];
    const newValues = newMap.get(key) ?? [];
    const count = Math.max(oldValues.length, newValues.length);
    for (let index = 0; index < count; index += 1) {
      const oldValue = oldValues[index] ? describe(oldValues[index]) : null;
      const newValue = newValues[index] ? describe(newValues[index]) : null;
      entries.push({ key: `${section}:${key}:${index}`, label: section === "asset" ? `Activo asegurado ${index + 1}` : `Persona asegurada ${index + 1}`, status: statusFor(oldValue, newValue), oldValue, newValue });
    }
  }
  return entries;
}

export function compareRenewalPolicies(previous: RenewalComparisonPolicy, renewal: RenewalComparisonPolicy): RenewalComparison {
  const scalarFields: Array<[string, string, string | null, string | null]> = [
    ["insurer", "Aseguradora", text(previous.insurerName), text(renewal.insurerName)],
    ["type", "Tipo de póliza", policyTypeValue(text(previous.policyType)), policyTypeValue(text(renewal.policyType))],
    ["currency", "Moneda", text(previous.currency), text(renewal.currency)],
    ["frequency", "Frecuencia de pago", frequencyValue(text(previous.paymentFrequency)), frequencyValue(text(renewal.paymentFrequency))],
    ["startDate", "Inicio de vigencia", dateValue(previous.startDate), dateValue(renewal.startDate)],
    ["endDate", "Fin de vigencia", dateValue(previous.endDate), dateValue(renewal.endDate)],
  ];
  const entries: RenewalComparisonEntry[] = scalarFields.map(([key, label, oldValue, newValue]) => ({ key, label, status: statusFor(oldValue, newValue), oldValue, newValue }));
  const oldPremium = previous.premiumAmount;
  const newPremium = renewal.premiumAmount;
  entries.push({
    key: "premium",
    label: "Prima",
    status: oldPremium === null ? (newPremium === null ? "MISSING" : "ADDED")
      : newPremium === null ? "REMOVED"
      : oldPremium === newPremium ? "UNCHANGED" : "CHANGED",
    oldValue: oldPremium === null ? null : formatCurrencyExact(oldPremium, previous.currency ?? undefined),
    newValue: newPremium === null ? null : formatCurrencyExact(newPremium, renewal.currency ?? undefined),
  });

  const oldRisk = flattenStructured(previous.riskDetails);
  const newRisk = flattenStructured(renewal.riskDetails);
  if (oldRisk || newRisk) {
    const keys = [...new Set([...(oldRisk?.keys() ?? []), ...(newRisk?.keys() ?? [])])].sort();
    for (const key of keys) {
      const oldEntry = oldRisk?.get(key) ?? null;
      const newEntry = newRisk?.get(key) ?? null;
      entries.push({ key: `risk:${key}`, label: oldEntry?.label ?? newEntry?.label ?? "Dato del riesgo", status: statusFor(oldEntry?.value ?? null, newEntry?.value ?? null), oldValue: oldEntry?.value ?? null, newValue: newEntry?.value ?? null });
    }
  }
  if (!oldRisk || oldRisk.size === 0 || !newRisk || newRisk.size === 0) {
    entries.push({ key: "risk:structured-data", label: "Datos estructurados del riesgo", status: "MISSING", oldValue: oldRisk && oldRisk.size > 0 ? "Disponibles" : null, newValue: newRisk && newRisk.size > 0 ? "Disponibles" : null });
  }
  entries.push(...collectionEntries("party", previous.insuredParties, renewal.insuredParties));
  entries.push(...collectionEntries("asset", previous.insuredAssets, renewal.insuredAssets));

  const counts: RenewalComparison["counts"] = { UNCHANGED: 0, CHANGED: 0, ADDED: 0, REMOVED: 0, MISSING: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  const premiumDifference = previous.currency && previous.currency === renewal.currency && previous.premiumAmount !== null && renewal.premiumAmount !== null && previous.premiumAmount !== 0
    ? { amount: renewal.premiumAmount - previous.premiumAmount, absoluteAmount: Math.abs(renewal.premiumAmount - previous.premiumAmount), percent: ((renewal.premiumAmount - previous.premiumAmount) / previous.premiumAmount) * 100, currency: previous.currency }
    : null;
  return {
    differences: entries.filter((entry) => entry.status !== "UNCHANGED").sort((a, b) => a.label.localeCompare(b.label, "es")),
    unchanged: entries.filter((entry) => entry.status === "UNCHANGED").sort((a, b) => a.label.localeCompare(b.label, "es")),
    counts,
    premiumDifference,
    legacyPreviousText: oldRisk && oldRisk.size > 0 ? null : text(previous.legacyText),
  };
}
