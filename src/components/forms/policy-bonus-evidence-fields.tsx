"use client";

import { useId } from "react";
import { parseBonusEligibilityEvidence } from "@/lib/bonus-evidence";

const damagePolicyTypes = new Set(["DANOS", "HOGAR", "EMPRESARIAL", "RESPONSABILIDAD_CIVIL", "OTRO"]);

function EvidenceBoolean({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | undefined;
  disabled: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <select
        id={id}
        value={value === undefined ? "" : String(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.value === "true")}
        className="h-10 min-w-0 rounded-md border bg-background px-3 disabled:opacity-60"
      >
        <option value="">Pendiente de confirmar</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

export function PolicyBonusEvidenceFields({
  policyType,
  value,
  disabled,
  error,
  onChange,
}: {
  policyType: string;
  value: string;
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  if (policyType !== "AUTO" && !damagePolicyTypes.has(policyType)) return null;

  const evidence = parseBonusEligibilityEvidence(value);
  const update = (key: string, nextValue: unknown) => {
    const next = { ...evidence } as Record<string, unknown>;
    if (nextValue === undefined || nextValue === "") delete next[key];
    else next[key] = nextValue;
    onChange(JSON.stringify(next));
  };
  const textInput = (key: string, label: string, value: string, inputType: "text" | "date" = "text") => (
    <label className="grid gap-1.5 text-sm" htmlFor={`${id}-${key}`}>
      <span className="font-medium">{label}</span>
      <input
        id={`${id}-${key}`}
        type={inputType}
        value={value}
        disabled={disabled}
        maxLength={500}
        onChange={(event) => update(key, event.currentTarget.value)}
        className="h-10 min-w-0 rounded-md border bg-background px-3 disabled:opacity-60"
      />
    </label>
  );
  const booleanInput = (key: string, label: string) => (
    <EvidenceBoolean
      key={key}
      id={`${id}-${key}`}
      label={label}
      value={typeof evidence[key] === "boolean" ? evidence[key] as boolean : undefined}
      disabled={disabled}
      onChange={(nextValue) => update(key, nextValue)}
    />
  );

  return (
    <section className="space-y-4 rounded-lg border bg-muted/15 p-4" aria-labelledby={`${id}-title`}>
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold">Evidencia de elegibilidad para bonos</h3>
        <p className="mt-1 text-xs text-muted-foreground">Los criterios pendientes mantienen las partidas del bono en revisión. La confirmación se registra con tu usuario y fecha al guardar.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {booleanInput("productEligible", "El producto cumple las reglas del programa")}
        {policyType === "AUTO" ? booleanInput("fleetUnder50", "Inventario completo con menos de 50 vehículos") : null}
        {policyType === "AUTO" ? booleanInput("autoExclusionsReviewed", "Exclusiones de Autos revisadas") : null}
        {policyType !== "AUTO" ? textInput("businessType", "Tipo de negocio", evidence.businessType ?? "") : null}
        {policyType !== "AUTO" ? booleanInput("facultativeInsuranceReviewed", "Reaseguro facultativo revisado") : null}
        {policyType !== "AUTO" ? booleanInput("specialConditionsReviewed", "Condiciones especiales revisadas") : null}
        {policyType !== "AUTO" ? booleanInput("directedBusinessReviewed", "Negocio dirigido revisado") : null}
        {policyType !== "AUTO" ? booleanInput("frontingReviewed", "Fronting revisado") : null}
        {policyType !== "AUTO" ? booleanInput("damageExclusionsReviewed", "Exclusiones de Daños revisadas") : null}
        {booleanInput("sellerAttributionConfirmed", "Atribución histórica al vendedor actual confirmada")}
        {textInput("sourceReference", "Fuente o referencia de la evidencia", evidence.sourceReference ?? "")}
        {textInput("evidenceAsOf", "Fecha de corte de la evidencia", evidence.evidenceAsOf ?? "", "date")}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
