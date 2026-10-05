"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid, FormSection } from "@/components/forms/form-primitives";
import type { PolicyType } from "@/lib/domain-values";
import { emptyPolicyRiskDetails, summarizePolicyRiskDetails, type PolicyRiskDetails } from "@/lib/policy-risk-details";

type Props = {
  policyType: PolicyType;
  value: unknown;
  onChange: (value: PolicyRiskDetails) => void;
};

type Item = Record<string, string>;
type RiskValue = { version: 1; policyType: PolicyType; data: Record<string, unknown> };

const templates: Record<string, Item> = {
  vehicles: { make: "", model: "", year: "", version: "", vin: "", plates: "" },
  insuredPeople: { fullName: "", birthDate: "", relationship: "" },
  beneficiaries: { fullName: "", relationship: "", percentage: "" },
  locations: { address: "", use: "", construction: "", activity: "", insuredValue: "" },
  attributes: { label: "", value: "" },
};

const repeatFields: Record<string, Array<[string, string]>> = {
  vehicles: [["make", "Marca"], ["model", "Modelo"], ["year", "Año"], ["version", "Versión"], ["vin", "Serie / VIN"], ["plates", "Placas"]],
  insuredPeople: [["fullName", "Nombre de la persona asegurada"], ["birthDate", "Fecha de nacimiento"], ["relationship", "Parentesco"]],
  beneficiaries: [["fullName", "Nombre del beneficiario"], ["relationship", "Parentesco"], ["percentage", "Porcentaje"]],
  locations: [["address", "Ubicación / domicilio"], ["use", "Uso del inmueble"], ["construction", "Tipo de construcción"], ["activity", "Actividad en el riesgo"], ["insuredValue", "Valor asegurado"]],
  attributes: [["label", "Dato"], ["value", "Valor"]],
};

const scalarFields: Partial<Record<PolicyType, Array<[string, string]>>> = {
  GMM: [["plan", "Plan médico"], ["insuredAmount", "Suma asegurada"], ["deductible", "Deducible"], ["coinsurance", "Coaseguro"]],
  VIDA: [["plan", "Plan"], ["insuredAmount", "Suma asegurada"], ["term", "Plazo"]],
  DANOS: [["activity", "Actividad asegurada"], ["coverageLimit", "Límite de cobertura"]],
  FIANZAS: [["obligation", "Obligación afianzada"], ["contractNumber", "Número de contrato"], ["beneficiary", "Beneficiario / beneficiaria"], ["bondedAmount", "Monto afianzado"], ["term", "Vigencia de la obligación"]],
  RESPONSABILIDAD_CIVIL: [["activity", "Actividad asegurada"], ["territory", "Territorio de cobertura"], ["coverageLimit", "Límite de cobertura"], ["operations", "Operaciones cubiertas"]],
  EMPRESARIAL: [["activity", "Actividad / giro del negocio"], ["buildingValue", "Valor del edificio"], ["contentsValue", "Valor de contenidos"], ["businessInterruptionValue", "Interrupción de negocio"]],
  ACCIDENTES: [["plan", "Plan"], ["insuredAmount", "Suma asegurada"], ["accidentCoverage", "Cobertura de accidentes"]],
  OTRO: [["category", "Categoría del riesgo"]],
};

const repeatedByType: Partial<Record<PolicyType, string[]>> = {
  AUTO: ["vehicles"], GMM: ["insuredPeople"], VIDA: ["insuredPeople", "beneficiaries"],
  DANOS: ["locations"], HOGAR: ["locations"], EMPRESARIAL: ["locations"],
  ACCIDENTES: ["insuredPeople"], OTRO: ["attributes"],
};

function asRiskValue(value: unknown, policyType: PolicyType): RiskValue {
  if (value && typeof value === "object" && "data" in value && "policyType" in value) return value as RiskValue;
  return emptyPolicyRiskDetails(policyType) as RiskValue;
}

export function PolicyRiskDetailsFields({ policyType, value, onChange }: Props) {
  const riskValue = asRiskValue(value, policyType);
  const data = riskValue.policyType === policyType ? riskValue.data : (emptyPolicyRiskDetails(policyType) as RiskValue).data;
  const collections = repeatedByType[policyType] ?? [];
  const normalizedValue = riskValue.policyType === policyType ? riskValue : emptyPolicyRiskDetails(policyType) as RiskValue;
  const displaySummary = summarizePolicyRiskDetails(normalizedValue);

  function addItem(key: string) {
    const items = Array.isArray(data[key]) ? data[key] as Item[] : [];
    onChange({ ...normalizedValue, version: 1, policyType, data: { ...data, [key]: [...items, { ...templates[key] }] } } as PolicyRiskDetails);
  }

  function removeItem(key: string, index: number) {
    const items = Array.isArray(data[key]) ? data[key] as Item[] : [];
    onChange({ ...normalizedValue, version: 1, policyType, data: { ...data, [key]: items.filter((_, itemIndex) => itemIndex !== index) } } as PolicyRiskDetails);
  }

  function changeItem(key: string, index: number, field: string, nextValue: string) {
    const items = Array.isArray(data[key]) ? data[key] as Item[] : [];
    const updated = items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: nextValue } : item);
    onChange({ ...normalizedValue, version: 1, policyType, data: { ...data, [key]: updated } } as PolicyRiskDetails);
  }

  function changeScalar(field: string, nextValue: string) {
    onChange({ ...normalizedValue, version: 1, policyType, data: { ...data, [field]: nextValue } } as PolicyRiskDetails);
  }

  return (
    <FormSection title="Riesgo asegurado" description="Captura datos específicos del ramo. Los campos se guardan estructurados y generan la descripción de la póliza.">
      {collections.map((key) => {
        const items = Array.isArray(data[key]) ? data[key] as Item[] : [];
        return (
          <div key={key} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">{key === "vehicles" ? "Vehículos asegurados" : key === "insuredPeople" ? "Personas aseguradas" : key === "beneficiaries" ? "Beneficiarios" : key === "locations" ? "Ubicaciones / bienes" : "Datos adicionales"}</h3>
              <Button type="button" variant="outline" size="sm" onClick={() => addItem(key)}>Agregar</Button>
            </div>
            {items.length === 0 ? <p className="text-sm text-muted-foreground">Agrega al menos un elemento cuando aplique.</p> : null}
            {items.map((_, index) => (
              <div key={`${key}-${index}`} className="space-y-3 rounded-md bg-muted/30 p-3">
                <FormGrid>
                  {repeatFields[key].map(([field, label]) => {
                    const inputId = `risk-${policyType}-${key}-${index}-${field}`;
                    return <FormField key={field} label={label} htmlFor={inputId}><Input id={inputId} value={items[index]?.[field] ?? ""} onChange={(event) => changeItem(key, index, field, event.target.value)} /></FormField>;
                  })}
                </FormGrid>
                {items.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(key, index)}>Quitar</Button> : null}
              </div>
            ))}
          </div>
        );
      })}
      {scalarFields[policyType]?.length ? (
        <FormGrid>
          {scalarFields[policyType]?.map(([field, label]) => {
            const inputId = `risk-${policyType}-${field}`;
            return <FormField key={field} label={label} htmlFor={inputId}><Input id={inputId} value={typeof data[field] === "string" ? data[field] as string : ""} onChange={(event) => changeScalar(field, event.target.value)} /></FormField>;
          })}
        </FormGrid>
      ) : null}
      {policyType === "HOGAR" || policyType === "DANOS" || policyType === "EMPRESARIAL" ? <p className="text-xs text-muted-foreground">Puedes registrar varias ubicaciones o bienes asegurados.</p> : null}
      <p className="text-xs text-muted-foreground">Descripción para listas: {displaySummary || "se mostrará cuando captures datos del riesgo"}</p>
    </FormSection>
  );
}
