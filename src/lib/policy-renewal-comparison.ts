import { policyRiskDetailsSchema } from "@/lib/policy-risk-details";

export type RenewalComparisonStatus = "UNCHANGED" | "CHANGED" | "ADDED" | "REMOVED" | "MISSING";

export type RenewalComparisonPolicy = {
  policyType: string | null;
  premiumAmount: number | null;
  currency: string | null;
  riskDetails: unknown;
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
  policyTypeChanged: boolean;
  premiums: {
    previous: { amount: number; currency: string | null } | null;
    renewal: { amount: number; currency: string | null } | null;
  };
  premiumDifference: { amount: number; absoluteAmount: number; percent: number; currency: string } | null;
};

export function formatPremiumPercent(percent: number): string {
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  const absolutePercent = Math.abs(percent);
  if (absolutePercent > 0 && absolutePercent < 0.05) return `${sign}<0.1%`;
  return `${sign}${absolutePercent.toFixed(1)}%`;
}

const riskLabels: Record<string, string> = {
  make: "Marca",
  model: "Modelo",
  year: "Año",
  version: "Versión",
  plan: "Plan",
  insuredAmount: "Suma asegurada",
  deductible: "Deducible",
  coinsurance: "Coaseguro",
  term: "Plazo",
  use: "Uso",
  construction: "Construcción",
  activity: "Actividad",
  insuredValue: "Valor asegurado",
  coverageLimit: "Límite de cobertura",
  obligation: "Obligación afianzada",
  bondedAmount: "Monto afianzado",
  territory: "Territorio",
  operations: "Operaciones",
  buildingValue: "Valor del edificio",
  contentsValue: "Valor de contenidos",
  businessInterruptionValue: "Interrupción de negocio",
  accidentCoverage: "Cobertura de accidentes",
  category: "Categoría",
};

const riskGroupLabels: Record<string, string> = {
  vehicles: "Vehículo",
  locations: "Ubicación",
};

const comparableFieldsByType: Record<string, ReadonlySet<string>> = {
  AUTO: new Set(["make", "model", "year", "version"]),
  GMM: new Set(["plan", "insuredAmount", "deductible", "coinsurance"]),
  VIDA: new Set(["plan", "insuredAmount", "term"]),
  DANOS: new Set(["activity", "insuredValue", "coverageLimit"]),
  FIANZAS: new Set(["obligation", "bondedAmount", "term"]),
  HOGAR: new Set(["use", "construction", "insuredValue"]),
  RESPONSABILIDAD_CIVIL: new Set(["activity", "territory", "coverageLimit", "operations"]),
  EMPRESARIAL: new Set(["activity", "buildingValue", "contentsValue", "businessInterruptionValue"]),
  ACCIDENTES: new Set(["plan", "insuredAmount", "accidentCoverage"]),
  OTRO: new Set(["category", "attributes"]),
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

  const allowedFields = comparableFieldsByType[parsed.data.policyType];
  if (!allowedFields) return null;

  const result = new Map<string, { label: string; value: string }>();
  const walk = (node: unknown, path: string[], labelPath: string[], fieldName: string | null = null) => {
    if (typeof node === "string") {
      const normalized = node.trim();
      if (normalized && fieldName && allowedFields.has(fieldName) && riskLabels[fieldName]) {
        result.set(path.join("."), { label: labelPath.join(" · "), value: normalized });
      }
      return;
    }

    if (Array.isArray(node)) {
      const arrayName = path.at(-1) ?? "";
      const occurrence = new Map<string, number>();
      node.forEach((item, index) => {
        const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
        const attributeLabel = arrayName === "attributes" ? text(record?.label) : null;
        const baseKey = attributeLabel ? `attribute:${attributeLabel}` : `#${index}`;
        const duplicateNumber = occurrence.get(baseKey) ?? 0;
        occurrence.set(baseKey, duplicateNumber + 1);
        const stableKey = `${baseKey}:${duplicateNumber}`;

        if (arrayName === "attributes" && record) {
          const attributeLabel = text(record.label);
          const attributeValue = text(record.value);
          if (attributeLabel && attributeValue) {
            result.set(`attributes:${stableKey}`, {
              label: `Atributo · ${attributeLabel}`,
              value: attributeValue,
            });
          }
          return;
        }

        walk(item, [...path, stableKey], [...labelPath, `${labelPath.at(-1) ?? "Dato"} ${index + 1}`]);
      });
      return;
    }

    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (
          key === "activity" &&
          (parsed.data.policyType === "DANOS" || parsed.data.policyType === "EMPRESARIAL") &&
          path.includes("locations")
        ) {
          continue;
        }
        const label = riskLabels[key] ?? riskGroupLabels[key] ?? key;
        walk(child, [...path, key], [...labelPath, label], key);
      }
    }
  };

  walk(parsed.data.data, [], []);
  return result;
}

export function compareRenewalPolicies(previous: RenewalComparisonPolicy, renewal: RenewalComparisonPolicy): RenewalComparison {
  const policyTypeChanged = Boolean(previous.policyType && renewal.policyType && previous.policyType !== renewal.policyType);
  const entries: RenewalComparisonEntry[] = [];

  if (!policyTypeChanged) {
    const oldRisk = flattenStructured(previous.riskDetails);
    const newRisk = flattenStructured(renewal.riskDetails);
    if (oldRisk || newRisk) {
      const keys = [...new Set([...(oldRisk?.keys() ?? []), ...(newRisk?.keys() ?? [])])].sort();
      for (const key of keys) {
        const oldEntry = oldRisk?.get(key) ?? null;
        const newEntry = newRisk?.get(key) ?? null;
        const oldValue = oldEntry?.value ?? null;
        const newValue = newEntry?.value ?? null;
        const status = statusFor(oldValue, newValue);
        if (status === "UNCHANGED" || status === "MISSING") continue;
        entries.push({
          key: `risk:${key}`,
          label: oldEntry?.label ?? newEntry?.label ?? "Dato",
          status,
          oldValue,
          newValue,
        });
      }
    }
  }

  const sameCurrency = Boolean(previous.currency && previous.currency === renewal.currency);
  const premiums = {
    previous: previous.premiumAmount === null ? null : { amount: previous.premiumAmount, currency: previous.currency },
    renewal: renewal.premiumAmount === null ? null : { amount: renewal.premiumAmount, currency: renewal.currency },
  };
  const premiumDifference = sameCurrency && previous.premiumAmount !== null && renewal.premiumAmount !== null && previous.premiumAmount !== 0
    ? {
        amount: renewal.premiumAmount - previous.premiumAmount,
        absoluteAmount: Math.abs(renewal.premiumAmount - previous.premiumAmount),
        percent: ((renewal.premiumAmount - previous.premiumAmount) / previous.premiumAmount) * 100,
        currency: previous.currency!,
      }
    : null;

  return {
    differences: entries.sort((a, b) => a.label.localeCompare(b.label, "es")),
    policyTypeChanged,
    premiums,
    premiumDifference,
  };
}
