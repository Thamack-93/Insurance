"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { selectAutoQuote } from "@/app/(dashboard)/quotes/actions";

export function QuoteComparisonTable({ comparison }: { comparison: { id: string; version: number; selectedQuoteId: string | null; items: Array<{ quoteId: string; quoteLabel: string; terms: string | null; reviewStatus: string }> } }) {
  const [pending, startTransition] = useTransition();
  function select(quoteId: string) {
    startTransition(async () => {
      const result = await selectAutoQuote({ comparisonId: comparison.id, quoteId, expectedVersion: comparison.version, reason: "Selección realizada desde la comparación." });
      if (!result.ok) toast.error(result.error); else toast.success(result.message);
    });
  }
  return <div className="space-y-4 print:space-y-2">
    <div className="flex justify-end print:hidden"><Button type="button" variant="outline" onClick={() => window.print()}>Imprimir comparación</Button></div>
    <div className="grid gap-4 md:grid-cols-2">
      {comparison.items.map((item) => <article key={item.quoteId} className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{item.quoteLabel}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.terms ?? "Términos no especificados."}</p>
        <p className="mt-3 text-xs text-muted-foreground">Revisión: {item.reviewStatus}</p>
        <Button className="mt-4 print:hidden" type="button" disabled={pending || item.reviewStatus !== "REVIEW"} onClick={() => select(item.quoteId)}>{comparison.selectedQuoteId === item.quoteId ? "Seleccionada" : "Seleccionar"}</Button>
      </article>)}
    </div>
  </div>;
}
