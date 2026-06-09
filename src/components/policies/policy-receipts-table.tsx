"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/badges/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";

export type PolicyReceiptRow = {
  id: string;
  receiptNumber: string;
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
            aria-label={`Abrir recibo ${receipt.receiptNumber} para editar`}
            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => router.push(`/receipts/${receipt.id}/edit`)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                router.push(`/receipts/${receipt.id}/edit`);
              }
            }}
          >
            <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
            <TableCell>{formatDate(receipt.dueDate)}</TableCell>
            <TableCell>
              <StatusBadge status={receipt.status} />
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
