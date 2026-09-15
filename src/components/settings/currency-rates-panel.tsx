"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MutationResult } from "@/lib/mutation-utils";

export type CurrencyRateRow = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  effectiveDate: string;
  rateToMxn: string;
};

type Props = {
  rates: CurrencyRateRow[];
  saveRate: (input: { fromCurrency: string; effectiveDate: string; rateToMxn: string }) => Promise<MutationResult>;
  deleteRate: (id: string) => Promise<MutationResult>;
};

export function CurrencyRatesPanel({ rates, saveRate, deleteRate }: Props) {
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rateToMxn, setRateToMxn] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await saveRate({ fromCurrency, effectiveDate, rateToMxn });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setRateToMxn("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteRate(id);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message);
    });
  }

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="currency-rates-title">
      <div className="flex flex-col gap-1">
        <h2 id="currency-rates-title" className="font-semibold">Tipos de cambio a MXN</h2>
        <p className="text-sm text-muted-foreground">Captura tasas históricas. Los importes originales nunca se modifican.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr_140px_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-medium">Moneda<Input value={fromCurrency} maxLength={3} onChange={(event) => setFromCurrency(event.target.value.toUpperCase())} aria-label="Moneda origen" /></label>
        <label className="grid gap-1 text-sm font-medium">Fecha efectiva<Input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">1 {fromCurrency || "USD"} = MXN<Input inputMode="decimal" value={rateToMxn} onChange={(event) => setRateToMxn(event.target.value)} aria-label="Tasa a MXN" /></label>
        <Button type="button" onClick={handleSave} disabled={pending || !effectiveDate || !rateToMxn}><Plus className="size-4" />Guardar</Button>
      </div>
      <div className="mt-5 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Tasas históricas configuradas</caption>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Moneda</th><th className="px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Tasa MXN</th><th className="px-3 py-2 text-right font-medium">Acciones</th></tr></thead>
          <tbody>
            {rates.map((rate) => <tr key={rate.id} className="border-t"><td className="px-3 py-2 font-medium">{rate.fromCurrency} → {rate.toCurrency}</td><td className="px-3 py-2">{rate.effectiveDate}</td><td className="px-3 py-2 font-mono">{rate.rateToMxn}</td><td className="px-3 py-2 text-right"><Button type="button" variant="ghost" size="sm" onClick={() => handleDelete(rate.id)} disabled={pending} aria-label={`Eliminar tasa ${rate.fromCurrency} ${rate.effectiveDate}`}><Trash2 className="size-4" /></Button></td></tr>)}
            {rates.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No hay tasas configuradas. MXN seguirá funcionando sin conversión.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {pending ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-3.5 animate-spin" />Guardando cambios…</p> : null}
    </section>
  );
}
