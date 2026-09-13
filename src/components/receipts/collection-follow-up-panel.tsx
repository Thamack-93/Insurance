"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CollectionOutcome } from "@/lib/collection-followups";
import type { MutationResult } from "@/lib/mutation-utils";

const outcomes: Array<{ value: CollectionOutcome; label: string }> = [
  { value: "NO_ANSWER", label: "Sin respuesta" },
  { value: "CONTACTED", label: "Contactado" },
  { value: "PROMISED_PAYMENT", label: "Prometió pago" },
  { value: "DISPUTED", label: "En disputa" },
  { value: "WRONG_CONTACT", label: "Contacto incorrecto" },
];

export function CollectionFollowUpPanel({
  receiptId,
  action,
}: {
  receiptId: string;
  action: (input: { receiptId: string; outcome: CollectionOutcome; notes?: string; promisedPaymentDate?: string; nextContactDate?: string; expectedVersion?: number }) => Promise<MutationResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CollectionOutcome>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [promisedPaymentDate, setPromisedPaymentDate] = useState("");
  const [nextContactDate, setNextContactDate] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await action({ receiptId, outcome, notes, promisedPaymentDate: promisedPaymentDate || undefined, nextContactDate: nextContactDate || undefined });
      if (!result.ok) toast.error(result.error);
      else { toast.success(result.message); setNotes(""); }
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Seguimiento de cobranza</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Registra el resultado del contacto y deja la próxima acción visible en Hoy.</p>
        <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={outcome} onChange={(event) => setOutcome(event.target.value as CollectionOutcome)} aria-label="Resultado del contacto">
          {outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        {outcome === "PROMISED_PAYMENT" ? <label className="block text-sm">Fecha prometida<input className="mt-1 h-10 w-full rounded-md border bg-background px-3" type="date" value={promisedPaymentDate} onChange={(event) => setPromisedPaymentDate(event.target.value)} /></label> : null}
        {outcome !== "PROMISED_PAYMENT" ? <label className="block text-sm">Próximo contacto<input className="mt-1 h-10 w-full rounded-md border bg-background px-3" type="date" value={nextContactDate} onChange={(event) => setNextContactDate(event.target.value)} /></label> : null}
        <textarea className="min-h-20 w-full rounded-md border bg-background p-3 text-sm" placeholder="Notas del contacto" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <Button type="button" disabled={isPending} onClick={submit}>{isPending ? "Guardando…" : "Guardar seguimiento"}</Button>
      </CardContent>
    </Card>
  );
}
