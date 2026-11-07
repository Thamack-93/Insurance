"use client";

import Link from "next/link";
import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import type { buildRenewalDraftReview } from "@/lib/policy-renewal-draft-review.logic";

type Result = ReturnType<typeof buildRenewalDraftReview>;

export function PolicyRenewalDraftReview({
  source,
  loading,
  result,
  confirmed,
  onConfirm,
}: {
  source: PolicyRenewalSource | null;
  loading: boolean;
  result: Result | null;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
}) {
  return (
    <section aria-labelledby="renewal-draft-review-heading" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div>
        <h3 id="renewal-draft-review-heading" className="font-semibold">Revisar renovación antes de guardar</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Los datos anteriores son una referencia, no una confirmación de la nueva cobertura.
          Comprueba el documento emitido por la aseguradora antes de guardar.
        </p>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Verificando la póliza anterior…</p>
      ) : !source || !result ? (
        <p role="alert" className="rounded-md border border-amber-300 p-3 text-sm text-amber-800 dark:text-amber-200">
          No se pudo verificar la póliza anterior seleccionada. Vuelve a seleccionarla antes de guardar.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Póliza de origen:{" "}
            <Link href={`/policies/${source.id}`} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
              {source.policyNumber}
            </Link>{" "}
            · {source.clientName} · {source.insurerName}
          </p>
          {result.issue ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
              {result.issue} No se podrá guardar este vínculo.
            </p>
          ) : null}

          {result.changes.length ? (
            <div className="overflow-hidden rounded-lg border bg-background">
              <p className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                Cambios detectados ({result.changes.length})
              </p>
              <div className="max-h-80 overflow-y-auto">
                {result.changes.map((change, index) => (
                  <div key={`${change.label}-${index}`} className="grid gap-1 border-b px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                    <span className="font-medium">{change.label}</span>
                    <span className="break-words text-muted-foreground">
                      <span className="text-foreground">{change.before}</span> → <span className="text-foreground">{change.after}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
              No se detectaron diferencias en los campos comparables. Verifica igualmente la vigencia y las condiciones del documento nuevo.
            </p>
          )}

          {result.warnings.length ? (
            <ul className="space-y-1 rounded-md border border-amber-300/70 p-3 text-sm text-amber-800 dark:text-amber-200">
              {result.warnings.map((warning) => <li key={warning}>· {warning}</li>)}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Revisa expresamente número, fechas, prima y desglose, asegurados, vehículos o ubicaciones y condiciones.
            Los pagos, recibos y comisiones anteriores no se copian.
          </p>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border bg-background p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={confirmed}
              onChange={(event) => onConfirm(event.target.checked)}
              disabled={Boolean(result.issue)}
            />
            <span>Confirmo que revisé la póliza de origen y verifiqué los datos y cambios de esta renovación.</span>
          </label>
        </>
      )}
    </section>
  );
}
