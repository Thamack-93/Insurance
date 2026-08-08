"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";

export type PolicyReceiptRow = {
  id: string;
  receiptNumber: string;
  displayLabel?: string;
  secondaryLabel?: string;
  originLabel?: string;
  dueDate: string;
  status: string;
  amount: number;
  currency: string;
};

export function PolicyReceiptsTable({ receipts }: { receipts: PolicyReceiptRow[] }) {
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead>Recibo</TableHead>
          <TableHead>Vencimiento</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Monto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {receipts.map((receipt) => (
          <TableRow
            key={receipt.id}
            tabIndex={0}
            role="link"
            aria-label={`Abrir recibo ${receipt.displayLabel ?? receipt.receiptNumber} para editar`}
            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => router.push(`/receipts/${receipt.id}/edit`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                router.push(`/receipts/${receipt.id}/edit`);
              }
            }}
          >
            <TableCell className="font-medium">
              <div className="flex min-w-0 flex-col gap-1">
                <span>{receipt.displayLabel ?? receipt.receiptNumber}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {receipt.originLabel ? (
                    <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                      {receipt.originLabel}
                    </Badge>
                  ) : null}
                  {receipt.secondaryLabel ? (
                    <span className="text-xs text-muted-foreground">{receipt.secondaryLabel}</span>
                  ) : null}
                </div>
              </div>
            </TableCell>
            <TableCell>{formatDate(receipt.dueDate)}</TableCell>
            <TableCell>
              <StatusBadge status={receipt.status} entity="receipt" />
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(receipt.amount, receipt.currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
