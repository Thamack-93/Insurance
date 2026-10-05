import { z } from "zod";
import { POLICY_TYPES, type PolicyType } from "@/lib/domain-values";

const text = z.string().trim().max(500).optional().default("");
const year = z.string().trim().regex(/^(|\d{4})$/, "El año debe tener cuatro dígitos.").optional().default("");
const people = z.array(z.object({ fullName: text, birthDate: text, relationship: text })).max(100).default([]);
const attributes = z.array(z.object({ label: text, value: text })).max(40).default([]);
const vehicles = z.array(z.object({ make: text, model: text, year, version: text, vin: text, plates: text })).max(100).default([]);
const locations = z.array(z.object({ address: text, use: text, construction: text, activity: text, insuredValue: text })).max(100).default([]);

const dataSchemas = {
  AUTO: z.object({ vehicles }),
  GMM: z.object({ insuredPeople: people, plan: text, insuredAmount: text, deductible: text, coinsurance: text }),
  VIDA: z.object({ insuredPeople: people, plan: text, insuredAmount: text, term: text, beneficiaries: z.array(z.object({ fullName: text, relationship: text, percentage: text })).max(100).default([]) }),
  DANOS: z.object({ locations, activity: text, coverageLimit: text }),
  FIANZAS: z.object({ obligation: text, contractNumber: text, beneficiary: text, bondedAmount: text, term: text }),
  HOGAR: z.object({ locations }),
  RESPONSABILIDAD_CIVIL: z.object({ activity: text, territory: text, coverageLimit: text, operations: text }),
  EMPRESARIAL: z.object({ activity: text, locations, buildingValue: text, contentsValue: text, businessInterruptionValue: text }),
  ACCIDENTES: z.object({ insuredPeople: people, plan: text, insuredAmount: text, accidentCoverage: text }),
  OTRO: z.object({ category: text, attributes }),
} satisfies Record<PolicyType, z.ZodType>;

const riskEnvelope = { version: z.literal(1), sourceText: z.string().trim().max(4000).optional() };
export const policyRiskDetailsSchema = z.discriminatedUnion("policyType", [
  z.object({ ...riskEnvelope, policyType: z.literal("AUTO"), data: dataSchemas.AUTO }),
  z.object({ ...riskEnvelope, policyType: z.literal("GMM"), data: dataSchemas.GMM }),
  z.object({ ...riskEnvelope, policyType: z.literal("VIDA"), data: dataSchemas.VIDA }),
  z.object({ ...riskEnvelope, policyType: z.literal("DANOS"), data: dataSchemas.DANOS }),
  z.object({ ...riskEnvelope, policyType: z.literal("FIANZAS"), data: dataSchemas.FIANZAS }),
  z.object({ ...riskEnvelope, policyType: z.literal("HOGAR"), data: dataSchemas.HOGAR }),
  z.object({ ...riskEnvelope, policyType: z.literal("RESPONSABILIDAD_CIVIL"), data: dataSchemas.RESPONSABILIDAD_CIVIL }),
  z.object({ ...riskEnvelope, policyType: z.literal("EMPRESARIAL"), data: dataSchemas.EMPRESARIAL }),
  z.object({ ...riskEnvelope, policyType: z.literal("ACCIDENTES"), data: dataSchemas.ACCIDENTES }),
  z.object({ ...riskEnvelope, policyType: z.literal("OTRO"), data: dataSchemas.OTRO }),
]);

export type PolicyRiskDetails = z.infer<typeof policyRiskDetailsSchema>;
export type RiskDetailsData = PolicyRiskDetails["data"];
export type RiskDetailsValue = Record<string, unknown>;

export function emptyPolicyRiskDetails(policyType: PolicyType): PolicyRiskDetails {
  const base = { version: 1 as const, policyType };
  switch (policyType) {
    case "AUTO": return { ...base, policyType, data: { vehicles: [{ make: "", model: "", year: "", version: "", vin: "", plates: "" }] } };
    case "GMM": return { ...base, policyType, data: { insuredPeople: [{ fullName: "", birthDate: "", relationship: "" }], plan: "", insuredAmount: "", deductible: "", coinsurance: "" } };
    case "VIDA": return { ...base, policyType, data: { insuredPeople: [{ fullName: "", birthDate: "", relationship: "" }], plan: "", insuredAmount: "", term: "", beneficiaries: [{ fullName: "", relationship: "", percentage: "" }] } };
    case "DANOS": return { ...base, policyType, data: { locations: [{ address: "", use: "", construction: "", activity: "", insuredValue: "" }], activity: "", coverageLimit: "" } };
    case "FIANZAS": return { ...base, policyType, data: { obligation: "", contractNumber: "", beneficiary: "", bondedAmount: "", term: "" } };
    case "HOGAR": return { ...base, policyType, data: { locations: [{ address: "", use: "", construction: "", activity: "", insuredValue: "" }] } };
    case "RESPONSABILIDAD_CIVIL": return { ...base, policyType, data: { activity: "", territory: "", coverageLimit: "", operations: "" } };
    case "EMPRESARIAL": return { ...base, policyType, data: { activity: "", locations: [{ address: "", use: "", construction: "", activity: "", insuredValue: "" }], buildingValue: "", contentsValue: "", businessInterruptionValue: "" } };
    case "ACCIDENTES": return { ...base, policyType, data: { insuredPeople: [{ fullName: "", birthDate: "", relationship: "" }], plan: "", insuredAmount: "", accidentCoverage: "" } };
    case "OTRO": return { ...base, policyType, data: { category: "", attributes: [{ label: "", value: "" }] } };
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function join(values: unknown[], separator = " · ") {
  return values.map(clean).filter(Boolean).join(separator);
}

export function summarizePolicyRiskDetails(value: unknown): string | null {
  const parsed = policyRiskDetailsSchema.safeParse(value);
  if (!parsed.success) return null;
  const { policyType, data } = parsed.data;
  switch (policyType) {
    case "AUTO": return join(data.vehicles.map((vehicle) => join([vehicle.make, vehicle.model, vehicle.year, vehicle.version, vehicle.plates ? `Placas ${vehicle.plates}` : "", vehicle.vin ? `Serie ${vehicle.vin}` : ""], " ")));
    case "GMM": return join([data.plan, data.insuredAmount ? `Suma asegurada ${data.insuredAmount}` : "", ...data.insuredPeople.map((person) => person.fullName)]);
    case "VIDA": return join([data.plan, data.insuredAmount ? `Suma asegurada ${data.insuredAmount}` : "", ...data.insuredPeople.map((person) => person.fullName)]);
    case "DANOS": return join([data.activity, ...data.locations.map((location) => join([location.address, location.use, location.activity, location.insuredValue ? `Valor ${location.insuredValue}` : ""], ", ")), data.coverageLimit]);
    case "FIANZAS": return join([data.obligation, data.contractNumber, data.beneficiary, data.bondedAmount ? `Monto afianzado ${data.bondedAmount}` : ""]);
    case "HOGAR": return join(data.locations.map((location) => join([location.address, location.use, location.construction, location.insuredValue ? `Valor ${location.insuredValue}` : ""], ", ")));
    case "RESPONSABILIDAD_CIVIL": return join([data.activity, data.operations, data.territory, data.coverageLimit]);
    case "EMPRESARIAL": return join([data.activity, ...data.locations.map((location) => join([location.address, location.activity, location.use], ", ")), data.buildingValue, data.contentsValue, data.businessInterruptionValue]);
    case "ACCIDENTES": return join([data.plan, data.accidentCoverage, data.insuredAmount ? `Suma asegurada ${data.insuredAmount}` : "", ...data.insuredPeople.map((person) => person.fullName)]);
    case "OTRO": return join([data.category, ...data.attributes.map((attribute) => join([attribute.label, attribute.value], ": "))]);
    default: return null;
  }
}

/**
 * Keeps the historical free-text description when structured fields are empty
 * or the legacy value could not be converted confidently.
 */
export function policyInsuredObjectForSave(value: unknown, fallback: string | null | undefined): string | null {
  const summary = summarizePolicyRiskDetails(value)?.trim();
  if (summary) return summary;

  const parsed = policyRiskDetailsSchema.safeParse(value);
  const sourceText = parsed.success ? parsed.data.sourceText?.trim() : "";
  return sourceText || fallback?.trim() || null;
}

export function hasPolicyRiskData(value: unknown): boolean {
  const parsed = policyRiskDetailsSchema.safeParse(value);
  if (!parsed.success) return false;
  const hasValue = (item: unknown): boolean => {
    if (typeof item === "string") return Boolean(item.trim());
    if (Array.isArray(item)) return item.some(hasValue);
    if (item && typeof item === "object") return Object.values(item).some(hasValue);
    return false;
  };
  return hasValue(parsed.data.data);
}

const detailLabels: Record<string, string> = {
  make: "Marca", model: "Modelo", year: "Año", version: "Versión", vin: "Serie / VIN", plates: "Placas",
  fullName: "Nombre", birthDate: "Fecha de nacimiento", relationship: "Parentesco", percentage: "Porcentaje",
  plan: "Plan", insuredAmount: "Suma asegurada", deductible: "Deducible", coinsurance: "Coaseguro", term: "Plazo",
  address: "Ubicación", use: "Uso", construction: "Construcción", activity: "Actividad", insuredValue: "Valor asegurado",
  coverageLimit: "Límite de cobertura", obligation: "Obligación afianzada", contractNumber: "Contrato", beneficiary: "Beneficiario",
  territory: "Territorio", operations: "Operaciones", buildingValue: "Valor del edificio", contentsValue: "Valor de contenidos",
  businessInterruptionValue: "Interrupción de negocio", accidentCoverage: "Cobertura de accidentes", category: "Categoría", label: "Dato", value: "Valor",
};

export function getPolicyRiskDetailEntries(value: unknown): Array<{ label: string; value: string }> {
  const parsed = policyRiskDetailsSchema.safeParse(value);
  if (!parsed.success) return [];
  const entries: Array<{ label: string; value: string }> = [];
  for (const [key, raw] of Object.entries(parsed.data.data)) {
    const title = detailLabels[key] ?? key;
    if (Array.isArray(raw)) {
      const group = key === "vehicles" ? "Vehículo" : key === "insuredPeople" ? "Persona asegurada" : key === "beneficiaries" ? "Beneficiario" : key === "locations" ? "Ubicación" : "Dato adicional";
      raw.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        for (const [field, fieldValue] of Object.entries(item)) {
          const displayValue = clean(fieldValue);
          if (displayValue) entries.push({ label: `${group} ${index + 1} · ${detailLabels[field] ?? field}`, value: displayValue });
        }
      });
    } else {
      const displayValue = clean(raw);
      if (displayValue) entries.push({ label: title, value: displayValue });
    }
  }
  return entries;
}

export function projectPolicyRiskRelations(value: unknown): {
  assets: Array<{ assetType: PolicyType; description: string; serialNumber: string | null; isPrimary: boolean }>;
  insuredParties: Array<{ fullName: string; isPrimary: boolean; sourceLabel: string }>;
} {
  const parsed = policyRiskDetailsSchema.safeParse(value);
  if (!parsed.success) return { assets: [], insuredParties: [] };
  const { policyType, data } = parsed.data;
  let assetDescriptions: Array<{ description: string; serialNumber?: string | null }> = [];
  let partyNames: string[] = [];
  if (policyType === "AUTO") {
    assetDescriptions = data.vehicles.map((vehicle) => ({
      description: join([vehicle.make, vehicle.model, vehicle.year, vehicle.version, vehicle.plates ? `Placas ${vehicle.plates}` : ""], " "),
      serialNumber: vehicle.vin || null,
    }));
  } else if (policyType === "HOGAR" || policyType === "DANOS" || policyType === "EMPRESARIAL") {
    assetDescriptions = data.locations.map((location) => ({ description: join([location.address, location.activity, location.use, location.construction, location.insuredValue ? `Valor ${location.insuredValue}` : ""], ", ") }));
  }
  if (policyType === "GMM" || policyType === "VIDA" || policyType === "ACCIDENTES") {
    partyNames = data.insuredPeople.map((person) => person.fullName);
  }
  return {
    assets: assetDescriptions.filter((asset) => asset.description).map((asset, index) => ({ assetType: policyType, description: asset.description, serialNumber: asset.serialNumber ?? null, isPrimary: index === 0 })),
    insuredParties: partyNames.filter(Boolean).map((fullName, index) => ({ fullName, isPrimary: index === 0, sourceLabel: "Datos estructurados de póliza" })),
  };
}

export function riskDetailsFromExisting(
  policyType: string,
  stored: unknown,
  insuredObject: string | null,
  assets: ReadonlyArray<{ description: string; serialNumber?: string | null }> = [],
  parties: ReadonlyArray<{ fullName: string }> = [],
  beneficiaryInfo: string | null = null,
): PolicyRiskDetails | null {
  const parsedStored = policyRiskDetailsSchema.safeParse(stored);
  if (parsedStored.success) {
    if (parsedStored.data.policyType === "VIDA" && !parsedStored.data.data.beneficiaries.length && beneficiaryInfo?.trim()) {
      return { ...parsedStored.data, data: { ...parsedStored.data.data, beneficiaries: [{ fullName: beneficiaryInfo.trim(), relationship: "", percentage: "" }] } };
    }
    if (parsedStored.data.policyType === "FIANZAS" && !parsedStored.data.data.beneficiary && beneficiaryInfo?.trim()) {
      return { ...parsedStored.data, data: { ...parsedStored.data.data, beneficiary: beneficiaryInfo.trim() } };
    }
    return parsedStored.data;
  }
  const sourceDescription = insuredObject?.trim() || assets.map((asset) => asset.description.trim()).filter(Boolean).join("; ") || null;
  const converted = convertLegacyPolicyDescription(policyType, sourceDescription, assets[0]?.serialNumber ?? null, assets.map((asset) => asset.serialNumber ?? null));
  if (converted.riskDetails) {
    if (converted.riskDetails.policyType === "VIDA" && !converted.riskDetails.data.beneficiaries.length && beneficiaryInfo?.trim()) {
      return { ...converted.riskDetails, data: { ...converted.riskDetails.data, beneficiaries: [{ fullName: beneficiaryInfo.trim(), relationship: "", percentage: "" }] } };
    }
    if (converted.riskDetails.policyType === "FIANZAS" && !converted.riskDetails.data.beneficiary && beneficiaryInfo?.trim()) {
      return { ...converted.riskDetails, data: { ...converted.riskDetails.data, beneficiary: beneficiaryInfo.trim() } };
    }
    return converted.riskDetails;
  }
  if (!POLICY_TYPES.includes(policyType as PolicyType)) return null;
  const type = policyType as PolicyType;
  const base = emptyPolicyRiskDetails(type) as RiskDetailsValue & { policyType: PolicyType; data: Record<string, unknown> };
  const data = { ...base.data };
  if (type === "GMM" || type === "VIDA" || type === "ACCIDENTES") {
    if (parties.length) data.insuredPeople = parties.map((party) => ({ fullName: party.fullName, birthDate: "", relationship: "" }));
  }
  const parsed = policyRiskDetailsSchema.safeParse({ version: 1, policyType: type, data });
  if (!parsed.success) return null;
  if (parsed.data.policyType === "VIDA" && beneficiaryInfo?.trim()) {
    return { ...parsed.data, sourceText: insuredObject?.trim() || undefined, data: { ...parsed.data.data, beneficiaries: [{ fullName: beneficiaryInfo.trim(), relationship: "", percentage: "" }] } };
  }
  if (parsed.data.policyType === "FIANZAS" && beneficiaryInfo?.trim()) {
    return { ...parsed.data, sourceText: insuredObject?.trim() || undefined, data: { ...parsed.data.data, beneficiary: beneficiaryInfo.trim() } };
  }
  const preservedSource = insuredObject?.trim() || assets.map((asset) => asset.description.trim()).filter(Boolean).join("; ");
  return preservedSource ? { ...parsed.data, sourceText: preservedSource } : parsed.data;
}

export type LegacyConversion = { riskDetails: PolicyRiskDetails | null; status: "CONVERTED" | "REVIEW" | "EMPTY"; reason: string | null };

/** Conservative one-time parser. Non-auto free text has no stable grammar and is preserved for review. */
export function convertLegacyPolicyDescription(policyType: string, description: string | null, serialNumber?: string | null, additionalSerialNumbers: ReadonlyArray<string | null> = []): LegacyConversion {
  const source = description?.trim() ?? "";
  if (!source) return { riskDetails: null, status: "EMPTY", reason: null };
  if (policyType !== "AUTO") {
    const values = new Map<string, string>();
    for (const segment of source.split(/[;|\n]+/).map((part) => part.trim()).filter(Boolean)) {
      const match = segment.match(/^([^:]{2,50}):\s*(.+)$/);
      if (match) values.set(match[1].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(), match[2].trim());
    }
    const get = (...labels: string[]) => labels.map((label) => values.get(label)).find(Boolean) ?? "";
    let data: Record<string, unknown> | null = null;
    if (policyType === "GMM" || policyType === "VIDA" || policyType === "ACCIDENTES") {
      const insuredName = get("asegurado", "asegurada", "persona asegurada", "titular");
      const insuredPeople = insuredName ? [{ fullName: insuredName, birthDate: get("fecha de nacimiento"), relationship: get("parentesco") }] : [];
      if (policyType === "GMM") data = { insuredPeople, plan: get("plan", "producto"), insuredAmount: get("suma asegurada", "suma"), deductible: get("deducible"), coinsurance: get("coaseguro") };
      if (policyType === "VIDA") {
        const beneficiary = get("beneficiario", "beneficiaria");
        data = { insuredPeople, plan: get("plan", "producto"), insuredAmount: get("suma asegurada", "suma"), term: get("plazo", "vigencia"), beneficiaries: beneficiary ? [{ fullName: beneficiary, relationship: get("parentesco beneficiario"), percentage: get("porcentaje") }] : [] };
      }
      if (policyType === "ACCIDENTES") data = { insuredPeople, plan: get("plan", "producto"), insuredAmount: get("suma asegurada", "suma"), accidentCoverage: get("cobertura", "cobertura de accidentes") };
    } else if (policyType === "HOGAR" || policyType === "DANOS" || policyType === "EMPRESARIAL") {
      const location = get("ubicacion", "domicilio", "direccion");
      const activity = get("actividad", "giro");
      const insuredValue = get("valor asegurado", "suma asegurada");
      const locations = location || activity || insuredValue
        ? [{ address: location, use: get("uso"), construction: get("construccion", "tipo de construccion"), activity, insuredValue }]
        : [];
      if (policyType === "HOGAR") data = { locations };
      if (policyType === "DANOS") data = { locations, activity, coverageLimit: get("limite", "limite de cobertura") };
      if (policyType === "EMPRESARIAL") data = { activity, locations, buildingValue: get("valor del edificio"), contentsValue: get("valor de contenidos"), businessInterruptionValue: get("interrupcion de negocio") };
    } else if (policyType === "FIANZAS") {
      data = { obligation: get("obligacion", "concepto afianzado"), contractNumber: get("contrato", "numero de contrato"), beneficiary: get("beneficiario", "beneficiaria"), bondedAmount: get("monto afianzado", "monto"), term: get("vigencia") };
    } else if (policyType === "RESPONSABILIDAD_CIVIL") {
      data = { activity: get("actividad", "giro"), territory: get("territorio", "territorio de cobertura"), coverageLimit: get("limite", "limite de cobertura"), operations: get("operaciones", "operaciones cubiertas") };
    } else if (policyType === "OTRO") {
      data = { category: get("categoria", "tipo"), attributes: [...values.entries()].map(([label, value]) => ({ label, value })) };
    }
    if (data) {
      const parsed = policyRiskDetailsSchema.safeParse({ version: 1, policyType, sourceText: source, data });
      if (parsed.success && hasPolicyRiskData(parsed.data)) return { riskDetails: parsed.data, status: "CONVERTED", reason: null };
    }
    return { riskDetails: null, status: "REVIEW", reason: "No se encontraron etiquetas del ramo con valores suficientes para una conversión confiable." };
  }

  const groups = source.split(/[;|\n]+/).map((group) => group.trim()).filter(Boolean);
  const parsedVehicles = groups.map((group, index) => {
    const parts = group.split(",").map((part) => part.trim()).filter(Boolean);
    const yearIndex = parts.findIndex((part) => /^(19|20)\d{2}$/.test(part));
    const make = parts[0] ?? "";
    const model = parts[1] ?? "";
    if (yearIndex !== 2 || !make || !model) return null;
    const embeddedVinIndex = parts.findIndex((part) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(part));
    return {
      make,
      model,
      year: parts[yearIndex],
      version: parts.slice(yearIndex + 1).filter((part) => !/^[A-HJ-NPR-Z0-9]{17}$/i.test(part)).join(" "),
      vin: additionalSerialNumbers[index]?.trim() || (index === 0 ? serialNumber?.trim() : "") || (embeddedVinIndex >= 0 ? parts[embeddedVinIndex] : ""),
      plates: "",
    };
  });
  if (!parsedVehicles.length || parsedVehicles.some((vehicle) => !vehicle)) {
    return { riskDetails: null, status: "REVIEW", reason: "No se identificaron marca, modelo y año con suficiente confianza." };
  }
  const details = {
    version: 1 as const,
    policyType: "AUTO" as const,
    sourceText: source,
    data: { vehicles: parsedVehicles },
  };
  const parsed = policyRiskDetailsSchema.safeParse(details);
  return parsed.success
    ? { riskDetails: parsed.data, status: "CONVERTED", reason: null }
    : { riskDetails: null, status: "REVIEW", reason: "La descripción no coincide con el formato esperado." };
}
