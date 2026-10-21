"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  BROKER_COMPARISON_FIELD_STATUSES,
  BROKER_COMPARISON_PILOT_LABEL,
  createBrokerComparisonPaymentSchedule,
  createBrokerComparisonOption,
  type BrokerComparisonDraft,
  type BrokerComparisonFieldStatus,
  type BrokerComparisonOption,
  type SavedBrokerComparisonExtraction,
} from "@/lib/broker-comparison-pdf.shared";
import { confirmBrokerComparisonExtraction, extractBrokerComparisonDocument } from "@/app/(dashboard)/documents/broker-comparison-actions";

type Props = {
  documentId: string;
  fileName: string;
  enabled: boolean;
  documentVersion: number;
  savedResult?: SavedBrokerComparisonExtraction | null;
};

const STATUS_LABELS: Record<BrokerComparisonFieldStatus, string> = {
  EXTRACTED: "Extraído",
  VERIFIED: "Verificado",
  MISSING: "Faltante",
  UNCERTAIN: "Incierto",
};

function StatusSelect({ value, onChange }: { value: BrokerComparisonFieldStatus; onChange: (value: BrokerComparisonFieldStatus) => void }) {
  return (
    <select
      aria-label="Estado del campo"
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      value={value}
      onChange={(event) => onChange(event.target.value as BrokerComparisonFieldStatus)}
    >
      {BROKER_COMPARISON_FIELD_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
    </select>
  );
}

function TextField({
  label,
  value,
  status,
  onValue,
  onStatus,
  multiline = false,
}: {
  label: string;
  value: string | null | string[];
  status: BrokerComparisonFieldStatus;
  onValue: (value: string | string[] | null) => void;
  onStatus: (value: BrokerComparisonFieldStatus) => void;
  multiline?: boolean;
}) {
  const text = Array.isArray(value) ? value.join("\n") : value ?? "";
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {multiline ? (
        <textarea
          className="min-h-20 rounded-md border border-input bg-background px-3 py-2"
          value={text}
          onChange={(event) => onValue(event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))}
          placeholder="Una opción por línea"
        />
      ) : (
        <input
          className="h-9 rounded-md border border-input bg-background px-3"
          value={text}
          onChange={(event) => onValue(event.target.value.trim() ? event.target.value : null)}
        />
      )}
      <span className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Estado</span>
        <StatusSelect value={status} onChange={onStatus} />
      </span>
    </label>
  );
}

function setTopField<K extends keyof Omit<BrokerComparisonDraft, "options">>(
  draft: BrokerComparisonDraft,
  key: K,
  value: string | null,
  status?: BrokerComparisonFieldStatus,
) {
  return { ...draft, [key]: { value, status: status ?? (value ? "VERIFIED" : "MISSING") } };
}

function statusForValue(value: string | string[] | null): BrokerComparisonFieldStatus {
  return Array.isArray(value) ? value.length > 0 ? "VERIFIED" : "MISSING" : value ? "VERIFIED" : "MISSING";
}

export function BrokerComparisonExtractionPanel({ documentId, fileName, enabled, documentVersion, savedResult = null }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrokerComparisonDraft | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [version, setVersion] = useState(documentVersion);
  const [saved, setSaved] = useState(savedResult);

  if (!enabled) return null;

  function runExtraction() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await extractBrokerComparisonDocument(documentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(result.value.extraction.draft);
      setWarnings(result.value.extraction.warnings);
      setVersion(result.value.documentVersion);
      setMessage("Borrador extraído. Revisa y corrige los campos antes de guardarlo.");
    });
  }

  function confirm() {
    if (!draft) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await confirmBrokerComparisonExtraction({
        documentId,
        expectedVersion: version,
        extraction: { draft, warnings },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setVersion(result.value.version);
      setSaved(result.value.saved);
      setDraft(null);
      setMessage("La revisión quedó guardada junto al PDF original.");
    });
  }

  function editTopField(key: keyof Omit<BrokerComparisonDraft, "options">, value: string | null, status?: BrokerComparisonFieldStatus) {
    setDraft((current) => current ? setTopField(current, key, value, status) : current);
  }

  function updateOption(index: number, key: keyof BrokerComparisonDraft["options"][number], value: string | string[] | null, status?: BrokerComparisonFieldStatus) {
    setDraft((current) => {
      if (!current) return current;
      const options = current.options.map((option, optionIndex) => optionIndex === index
        ? { ...option, [key]: { value, status: status ?? statusForValue(value) } }
        : option);
      return { ...current, options };
    });
  }

  function updatePaymentSchedule(
    optionIndex: number,
    scheduleIndex: number,
    key: keyof NonNullable<BrokerComparisonOption["paymentSchedules"]>[number],
    value: string | null,
    status?: BrokerComparisonFieldStatus,
  ) {
    setDraft((current) => {
      if (!current) return current;
      const options = current.options.map((option, currentOptionIndex) => {
        if (currentOptionIndex !== optionIndex) return option;
        const paymentSchedules = (option.paymentSchedules ?? []).map((schedule, currentScheduleIndex) => currentScheduleIndex === scheduleIndex
          ? { ...schedule, [key]: { value, status: status ?? statusForValue(value) } }
          : schedule);
        return { ...option, paymentSchedules };
      });
      return { ...current, options };
    });
  }

  return (
    <section className="rounded-lg border bg-background p-4" aria-label="Extracción de comparación del corredor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">Lectura piloto de comparación</h4>
          <p className="mt-1 text-xs text-amber-800">{BROKER_COMPARISON_PILOT_LABEL}</p>
          <p className="mt-1 text-xs text-muted-foreground">{fileName} · El original permanece en Documentos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" asChild>
            <a href={`/api/documents/${encodeURIComponent(documentId)}/download?inline=1`} target="_blank" rel="noreferrer">Ver PDF original</a>
          </Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={runExtraction}>{isPending ? "Analizando…" : saved ? "Volver a analizar" : "Extraer datos"}</Button>
        </div>
      </div>

      {saved ? (
        <p className="mt-3 text-sm text-muted-foreground">Revisión confirmada el {saved.confirmedAt.slice(0, 16).replace("T", " ")} UTC · {saved.draft.options.length} opciones guardadas.</p>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p> : null}
      {warnings.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul> : null}

      {draft ? (
        <div className="mt-4 space-y-5 border-t pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ["brokerName", "Corredor"], ["clientName", "Cliente"], ["policyType", "Tipo de seguro"], ["insuredAsset", "Bien asegurado"], ["validityDate", "Vigencia de la oferta"],
            ] as const).map(([key, label]) => (
              <TextField key={key} label={label} value={draft[key].value} status={draft[key].status}
                onValue={(value) => editTopField(key, typeof value === "string" ? value : null)}
                onStatus={(status) => editTopField(key, draft[key].value, status)} />
            ))}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h5 className="font-semibold">Opciones detectadas</h5>
              <Button type="button" size="sm" variant="outline" disabled={draft.options.length >= 12}
                onClick={() => setDraft((current) => current ? { ...current, options: [...current.options, createBrokerComparisonOption()] } : current)}>
                Añadir opción
              </Button>
            </div>
            {draft.options.length === 0 ? <p className="text-sm text-muted-foreground">No se detectaron opciones. Puedes añadirlas manualmente.</p> : null}
            {draft.options.map((option, index) => (
              <fieldset key={index} className="grid gap-4 rounded-md border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Opción {index + 1}</legend>
                {([
                  ["insurerName", "Aseguradora"], ["productPlan", "Producto / plan"], ["premium", "Prima (texto original)"], ["currency", "Moneda"],
                  ["paymentOptions", "Opciones de pago"], ["coverageLimits", "Límites / coberturas"], ["deductibles", "Deducibles"], ["exclusions", "Exclusiones"],
                ] as const).map(([key, label]) => (
                  <TextField key={key} label={label} value={option[key].value} status={option[key].status} multiline={Array.isArray(option[key].value)}
                    onValue={(value) => updateOption(index, key, value)}
                    onStatus={(status) => updateOption(index, key, option[key].value, status)} />
                ))}
                <div className="space-y-3 sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h6 className="text-sm font-medium">Primas por modalidad de pago</h6>
                    <Button type="button" size="sm" variant="outline" disabled={(option.paymentSchedules?.length ?? 0) >= 8}
                      onClick={() => setDraft((current) => current ? {
                        ...current,
                        options: current.options.map((currentOption, currentOptionIndex) => currentOptionIndex === index
                          ? { ...currentOption, paymentSchedules: [...(currentOption.paymentSchedules ?? []), createBrokerComparisonPaymentSchedule()] }
                          : currentOption),
                      } : current)}>
                      Añadir modalidad
                    </Button>
                  </div>
                  {(option.paymentSchedules ?? []).map((schedule, scheduleIndex) => (
                    <fieldset key={scheduleIndex} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                      <legend className="px-1 text-xs font-medium">Modalidad {scheduleIndex + 1}</legend>
                      {([
                        ["frequency", "Frecuencia"], ["totalPremium", "Prima total"], ["firstPayment", "Primer pago"],
                        ["subsequentPaymentCount", "Número de pagos subsecuentes"], ["subsequentPaymentAmount", "Importe por pago subsecuente"],
                      ] as const).map(([key, label]) => (
                        <TextField key={key} label={label} value={schedule[key].value} status={schedule[key].status}
                          onValue={(value) => updatePaymentSchedule(index, scheduleIndex, key, typeof value === "string" ? value : null)}
                          onStatus={(status) => updatePaymentSchedule(index, scheduleIndex, key, schedule[key].value, status)} />
                      ))}
                      <div className="sm:col-span-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => current ? {
                          ...current,
                          options: current.options.map((currentOption, currentOptionIndex) => currentOptionIndex === index
                            ? { ...currentOption, paymentSchedules: (currentOption.paymentSchedules ?? []).filter((_, paymentIndex) => paymentIndex !== scheduleIndex) }
                            : currentOption),
                        } : current)}>
                          Quitar modalidad
                        </Button>
                      </div>
                    </fieldset>
                  ))}
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => current ? { ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index) } : current)}>
                    Quitar opción
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-2xl text-xs text-muted-foreground">Los términos entre aseguradoras no se normalizan ni se consideran equivalentes. Confirma solo después de revisar cada valor.</p>
            <Button type="button" disabled={isPending} onClick={confirm}>{isPending ? "Guardando…" : "Confirmar y guardar revisión"}</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

