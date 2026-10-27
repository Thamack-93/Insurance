"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ItemStatus = "INCLUDED" | "EXCLUDED" | "REVIEW";
type BonusItemRow = {
  id: string;
  status: ItemStatus;
  paymentReference: string;
  receiptNumber: string | null;
  receiptHref: string | null;
  policyNumber: string | null;
  policyHref: string | null;
  paidDate: string;
  paidAmount: string;
  netPremiumPaid: string;
  eligibleAmount: string;
  reason: string;
  evidenceJson: string | null;
};

const filters: { key: "ALL" | ItemStatus; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "INCLUDED", label: "Incluidas" },
  { key: "EXCLUDED", label: "Excluidas" },
  { key: "REVIEW", label: "En revisión" },
];

function itemStatusLabel(status: ItemStatus) {
  if (status === "INCLUDED") return "Incluida";
  if (status === "EXCLUDED") return "Excluida";
  return "Revisión";
}

function prettyEvidence(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

export function BonusRunItemsTable({ items }: { items: BonusItemRow[] }) {
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]["key"]>("ALL");
  const counts = {
    ALL: items.length,
    INCLUDED: items.filter((item) => item.status === "INCLUDED").length,
    EXCLUDED: items.filter((item) => item.status === "EXCLUDED").length,
    REVIEW: items.filter((item) => item.status === "REVIEW").length,
  };
  const visibleItems = activeFilter === "ALL" ? items : items.filter((item) => item.status === activeFilter);

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Filtrar partidas por estado" className="flex flex-wrap gap-2" role="group">
          {filters.map((filter) => {
            const selected = activeFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setActiveFilter(filter.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                {filter.label} <span className="ml-1 tabular-nums">{counts[filter.key]}</span>
              </button>
            );
          })}
        </div>
        <p aria-live="polite" className="text-xs text-muted-foreground">{visibleItems.length} {visibleItems.length === 1 ? "partida" : "partidas"}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Estado</TableHead><TableHead>Pago</TableHead><TableHead>Recibo / póliza</TableHead><TableHead>Fecha</TableHead><TableHead>Pagado</TableHead><TableHead>PNP asignada</TableHead><TableHead>Elegible MXN</TableHead><TableHead>Motivo / evidencia</TableHead></TableRow></TableHeader>
          <TableBody>
            {visibleItems.length ? visibleItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${item.status === "INCLUDED" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : item.status === "EXCLUDED" ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>{itemStatusLabel(item.status)}</span></TableCell>
                <TableCell className="font-mono text-xs">{item.paymentReference}</TableCell>
                <TableCell>
                  <div className="flex min-w-32 flex-col items-start gap-1">
                    {item.receiptHref ? <Link className="text-primary underline-offset-4 hover:underline" href={item.receiptHref}>Recibo {item.receiptNumber ?? "sin número"}</Link> : <span>Recibo {item.receiptNumber ?? "—"}</span>}
                    {item.policyHref ? <Link className="text-primary underline-offset-4 hover:underline" href={item.policyHref}>Póliza {item.policyNumber ?? "sin número"}</Link> : <span>Póliza {item.policyNumber ?? "—"}</span>}
                  </div>
                </TableCell>
                <TableCell>{item.paidDate}</TableCell>
                <TableCell>{item.paidAmount}</TableCell>
                <TableCell>{item.netPremiumPaid}</TableCell>
                <TableCell>{item.eligibleAmount}</TableCell>
                <TableCell className="max-w-sm whitespace-normal text-xs"><span>{item.reason}</span>{item.evidenceJson ? <details className="mt-1"><summary className="cursor-pointer text-primary">Ver evidencia</summary><pre className="mt-1 max-w-sm whitespace-pre-wrap break-all text-[10px]">{prettyEvidence(item.evidenceJson)}</pre></details> : null}</TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{items.length ? "No hay partidas con este estado." : "No hay pagos que coincidan con el programa, vendedor y periodo."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
