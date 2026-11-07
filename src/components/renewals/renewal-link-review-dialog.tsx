"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import { buildRenewalDraftReview } from "@/lib/policy-renewal-draft-review.logic";
import { formatCurrencyExact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { policyTypeLabel } from "@/lib/status";

export type RenewalLinkReview = {
  source: PolicyRenewalSource;
  target: PolicyRenewalSource;
};

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function RenewalLinkReviewDialog({
  review,
  allowDifferentInsurer = false,
  pending = false,
  onOpenChange,
  onConfirm,
}: {
  review: RenewalLinkReview | null;
  allowDifferentInsurer?: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (versions: { sourceUpdatedAt: string; targetUpdatedAt: string }) => void;
}) {
  const [confirmationKey, setConfirmationKey] = useState("");

  const result = useMemo(() => {
    if (!review) return null;
    const sourceForReview = allowDifferentInsurer
      ? { ...review.source, insurerId: review.target.insurerId }
      : review.source;
    return buildRenewalDraftReview(sourceForReview, {
      clientId: review.target.clientId,
      insurerId: review.target.insurerId,
      policyType: review.target.policyType,
      policyNumber: review.target.policyNumber,
      startDate: dateInput(review.target.startDate),
      endDate: dateInput(review.target.endDate),
      premiumAmount: review.target.premiumAmount,
      currency: review.target.currency,
      paymentFrequency: review.target.paymentFrequency,
      riskDetails: review.target.riskDetails ?? undefined,
      premiumIssuanceExpenseAmount: "",
      premiumSurchargeAmount: "",
      premiumDiscountAmount: "",
    });
  }, [allowDifferentInsurer, review]);

  const sourceVersion = review?.source.updatedAt?.toISOString();
  const targetVersion = review?.target.updatedAt?.toISOString();
  const reviewKey = review && sourceVersion && targetVersion
    ? `${review.source.id}:${sourceVersion}:${review.target.id}:${targetVersion}`
    : "";
  const confirmed = Boolean(reviewKey) && confirmationKey === reviewKey;

  function handleOpenChange(open: boolean) {
    if (!open) setConfirmationKey("");
    onOpenChange(open);
  }

  return (
    <Dialog open={Boolean(review)} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verificar vínculo de renovación</DialogTitle>
          <DialogDescription>Compara ambas vigencias y confirma que la póliza destino corresponde a esta renovación.</DialogDescription>
        </DialogHeader>
        {review && result ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {[review.source, review.target].map((policy, index) => (
                <section key={policy.id} className="rounded-lg border p-3" aria-label={index === 0 ? "Póliza anterior" : "Nueva vigencia"}>
                  <h3 className="font-semibold">{index === 0 ? "Póliza anterior" : "Nueva vigencia"}</h3>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Póliza</dt><dd className="text-right font-medium">{policy.policyNumber}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Cliente</dt><dd className="text-right">{policy.clientName}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Aseguradora</dt><dd className="text-right">{policy.insurerName}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Ramo</dt><dd className="text-right">{policyTypeLabel(policy.policyType)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Vigencia</dt><dd className="text-right">{formatDate(policy.startDate)} – {formatDate(policy.endDate)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Prima</dt><dd className="text-right">{formatCurrencyExact(policy.premiumAmount, policy.currency)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Frecuencia</dt><dd className="text-right">{policy.paymentFrequency}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Riesgo</dt><dd className="max-w-[65%] text-right">{policy.insuredObject || "Sin descripción"}</dd></div>
                  </dl>
                </section>
              ))}
            </div>
            {review.source.insurerId !== review.target.insurerId ? (
              <p className="rounded-md border border-amber-300 p-3 text-sm text-amber-900 dark:text-amber-100">
                Cambia la aseguradora. El vínculo solo se permitirá si la sugerencia vigente confirma la misma serie/VIN.
              </p>
            ) : null}
            {result.issue ? <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{result.issue}</p> : null}
            {result.changes.length ? (
              <div className="rounded-lg border">
                <p className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">Cambios detectados ({result.changes.length})</p>
                <ul className="max-h-56 divide-y overflow-y-auto">
                  {result.changes.map((change, index) => (
                    <li key={`${change.label}-${index}`} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                      <span className="font-medium">{change.label}</span>
                      <span className="break-words text-muted-foreground">{change.before} → {change.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className="rounded-md border p-3 text-sm text-muted-foreground">No hay diferencias en los campos comparables. Verifica igualmente que la nueva vigencia corresponde a esta renovación.</p>}
            {result.warnings.length ? (
              <ul className="rounded-md border border-amber-300 p-3 text-sm text-amber-900 dark:text-amber-100">
                {result.warnings.map((warning) => <li key={warning}>· {warning}</li>)}
              </ul>
            ) : null}
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={confirmed} onChange={(event) => setConfirmationKey(event.target.checked ? reviewKey : "")} disabled={Boolean(result.issue)} />
              <span>Confirmo que revisé las dos pólizas, sus vigencias, primas y datos del riesgo.</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
              <Button
                type="button"
                disabled={!confirmed || Boolean(result.issue) || pending || !sourceVersion || !targetVersion}
                onClick={() => sourceVersion && targetVersion && onConfirm({ sourceUpdatedAt: sourceVersion, targetUpdatedAt: targetVersion })}
              >
                {pending ? "Vinculando…" : "Confirmar vínculo"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
