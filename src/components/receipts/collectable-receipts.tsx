"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/badges/status-badge";
import { QuickPaymentDialog } from "@/components/payments/quick-payment-dialog";
import { CancelReceiptButton } from "@/components/receipts/cancel-receipt-button";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";
import {
  BulkActionsProvider,
  useBulkActions,
} from "@/components/bulk-actions/bulk-actions-provider";
import { formatDate, isOverdue } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { parseBusinessDateInput } from "@/lib/business-dates";
import { bulkMarkReceiptsPaid } from "@/app/(dashboard)/receipts/actions";

export type CollectableReceipt = {
  id: string;
  receiptNumber: string;
  originLabel?: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  client: { fullName: string };
  policy: { policyNumber: string; status: string };
  insurer: { name: string };
  endorsement?: { endorsementNumber: string; reference?: string | null };
  paymentCount: number;
};

export function CollectableReceipts({ receipts }: { receipts: CollectableReceipt[] }) {
  if (receipts.length === 0) return null;

  return (
    <BulkActionsProvider>
      <div className="space-y-3">
        <BulkToolbar receipts={receipts} />
        <div className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} />
          ))}
        </div>
      </div>
    </BulkActionsProvider>
  );
}

function BulkToolbar({ receipts }: { receipts: CollectableReceipt[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { selectedItems, hasSelection, clearSelection, getSelectedIds, selectAll } =
    useBulkActions();
  const allIds = receipts.map((r) => r.id);
  const selectedCount = selectedItems.size;

  const handleConfirm = async () => {
    const ids = getSelectedIds();
    if (ids.length === 0) {
      toast.error("Selecciona al menos un recibo.");
      return;
    }
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        const result = await bulkMarkReceiptsPaid(ids, "TRANSFER");
        if (result.ok) {
          toast.success(result.message ?? "Recibos marcados como pagados.");
          flushSync(() => {
            clearSelection();
          });
          router.refresh();
        } else {
          toast.error(result.error ?? "No se pudo marcar como pagados.");
        }
        resolve();
      });
    });
  };

  if (!hasSelection) {
    return (
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 text-xs text-muted-foreground"
          onClick={() => selectAll(allIds)}
        >
          Seleccionar todos en esta página ({allIds.length})
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-300/70 bg-emerald-50/90 px-4 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-emerald-900">
            {selectedCount} recibo{selectedCount !== 1 ? "s" : ""} seleccionado{selectedCount !== 1 ? "s" : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => clearSelection()}
            disabled={isPending}
          >
            Limpiar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={isPending}
            className="h-8 gap-1"
            onClick={() => setConfirmOpen(true)}
          >
            <BadgeCheck className="size-3.5" />
            Marcar pagados
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Marcar ${selectedCount} recibo${selectedCount !== 1 ? "s" : ""} como pagado${selectedCount !== 1 ? "s" : ""}`}
        description="Se registrará un pago por transferencia con la fecha de hoy. Los recibos ya pagados o cancelados se omiten."
        confirmLabel="Marcar pagados"
        onConfirm={handleConfirm}
      />
    </>
  );
}

function ReceiptRow({ receipt }: { receipt: CollectableReceipt }) {
  const { selectedItems, toggleItem } = useBulkActions();
  const isSelected = selectedItems.has(receipt.id);
  const due = parseBusinessDateInput(receipt.dueDate);
  const overdue = isOverdue(due);

  return (
    <div
      className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
      data-selected={isSelected}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="pt-0.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleItem(receipt.id)}
            aria-label={`Seleccionar recibo ${receipt.receiptNumber}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/receipts/${receipt.id}`}
              className="font-medium text-foreground hover:text-primary"
            >
              {receipt.receiptNumber}
            </Link>
            {receipt.originLabel ? (
              <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] text-muted-foreground">
                {receipt.originLabel}
              </Badge>
            ) : null}
            <Badge variant={overdue ? "destructive" : "secondary"}>
              {overdue ? "Vencido" : "Pendiente"}
            </Badge>
            <StatusBadge status={receipt.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {receipt.client.fullName} · {receipt.policy.policyNumber} · {receipt.insurer.name}
          </p>
          {receipt.endorsement ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Endoso {receipt.endorsement.endorsementNumber}
              {receipt.endorsement.reference ? ` · ${receipt.endorsement.reference}` : ""}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">Vence {formatDate(due)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 md:text-right">
        <div>
          <p className="font-semibold">{formatCurrency(receipt.amount, receipt.currency)}</p>
          <p className="text-xs text-muted-foreground">{receipt.currency}</p>
        </div>
          <QuickPaymentDialog
            receipt={{
              id: receipt.id,
              receiptNumber: receipt.receiptNumber,
              originLabel: receipt.originLabel,
              amount: receipt.amount,
              currency: receipt.currency,
              dueDate: receipt.dueDate,
              client: { fullName: receipt.client.fullName },
            policy: { policyNumber: receipt.policy.policyNumber },
            endorsement: receipt.endorsement,
          }}
        />
        {receipt.status !== "CANCELLED" && receipt.paymentCount === 0 ? (
          <CancelReceiptButton
            id={receipt.id}
            receiptNumber={receipt.receiptNumber}
            triggerLabel="Cancelar"
            triggerClassName="h-8 rounded-full bg-card/70 px-3 text-xs"
          />
        ) : null}
      </div>
    </div>
  );
}
