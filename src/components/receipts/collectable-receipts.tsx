"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { BadgeCheck, ChevronDown, Link2, MessageSquare } from "lucide-react";
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
import { appendReturnTo } from "@/lib/return-to";
import { QualitasPaymentLinkDialog } from "@/components/receipts/qualitas-payment-link-dialog";
import { QualitasReceiptMonitorPanel } from "@/components/policies/qualitas-receipt-monitor-panel";
import { WhatsAppReminderButton, type WhatsAppReminderHandle } from "@/components/receipts/whatsapp-reminder-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type CollectableReceipt = {
  id: string;
  receiptNumber: string;
  originLabel?: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  client: { fullName: string };
  policy: { id: string; policyNumber: string; status: string; paymentFrequency: string; qualitasReceiptMonitorEnabled: boolean };
  insurer: { name: string };
  endorsement?: { endorsementNumber: string; reference?: string | null };
  paymentCount: number;
  clientEmail?: string | null;
  clientPhone?: string | null;
  agentEmail?: string | null;
  agentPhone?: string | null;
  qualitasEnabled?: boolean;
  qualitasClientRecipientEnabled?: boolean;
  qualitasEligible?: boolean;
  qualitasMonitorEligible?: boolean;
};

export function CollectableReceipts({ receipts, returnTo, isDemo = false, qualitasMonitorFeatureEnabled }: { receipts: CollectableReceipt[]; returnTo?: string; isDemo?: boolean; qualitasMonitorFeatureEnabled: boolean }) {
  if (receipts.length === 0) return null;

  return (
    <BulkActionsProvider>
      <div className="overflow-hidden rounded-md border border-border/70 bg-card">
        <BulkToolbar receipts={receipts} />
        <div className="divide-y divide-border/70">
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} returnTo={returnTo} isDemo={isDemo} qualitasMonitorFeatureEnabled={qualitasMonitorFeatureEnabled} />
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
      <div className="flex min-h-10 items-center justify-end border-b border-border/70 bg-muted/20 px-3">
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-300/70 bg-emerald-50/90 px-4 py-2">
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

function ReceiptRow({ receipt, returnTo, isDemo, qualitasMonitorFeatureEnabled }: { receipt: CollectableReceipt; returnTo?: string; isDemo: boolean; qualitasMonitorFeatureEnabled: boolean }) {
  const { selectedItems, toggleItem } = useBulkActions();
  const whatsappRef = useRef<WhatsAppReminderHandle>(null);
  const [dialogAction, setDialogAction] = useState<"qualitas-payment" | "qualitas-monitor" | null>(null);
  const isSelected = selectedItems.has(receipt.id);
  const due = parseBusinessDateInput(receipt.dueDate);
  const overdue = isOverdue(due);

  return (
    <div
      className="flex flex-col gap-4 px-4 py-4 xl:flex-row xl:items-center xl:justify-between"
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
              href={appendReturnTo(`/receipts/${receipt.id}`, returnTo)}
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
            <StatusBadge status={receipt.status} entity="receipt" />
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
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3 xl:min-w-[26rem] xl:border-t-0 xl:pt-0">
        <div className="flex items-baseline justify-between gap-3 xl:justify-end">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Monto</span>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{formatCurrency(receipt.amount, receipt.currency)}</p>
            <p className="text-xs text-muted-foreground">{receipt.currency}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <QuickPaymentDialog
            className="h-8 px-3 text-xs"
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
          {((receipt.status === "PENDING" || receipt.status === "OVERDUE") || (receipt.qualitasEligible && receipt.qualitasEnabled) || (receipt.qualitasMonitorEligible && qualitasMonitorFeatureEnabled)) ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" className="h-8 gap-1 px-3 text-xs" />}>
                Acciones
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {receipt.status === "PENDING" || receipt.status === "OVERDUE" ? (
                  <DropdownMenuItem onClick={() => whatsappRef.current?.trigger()}>
                    <MessageSquare className="size-4" />
                    Avisar por WhatsApp
                  </DropdownMenuItem>
                ) : null}
                {receipt.qualitasEligible && receipt.qualitasEnabled ? (
                  <DropdownMenuItem onClick={() => setDialogAction("qualitas-payment")}>
                    <Link2 className="size-4" />
                    Liga de pago Quálitas
                  </DropdownMenuItem>
                ) : null}
                {receipt.qualitasMonitorEligible && qualitasMonitorFeatureEnabled ? (
                  <DropdownMenuItem onClick={() => setDialogAction("qualitas-monitor")}>
                    <BadgeCheck className="size-4" />
                    Verificar pago
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {receipt.status !== "CANCELLED" && receipt.paymentCount === 0 ? (
            <CancelReceiptButton
              id={receipt.id}
              receiptNumber={receipt.receiptNumber}
              triggerLabel="Cancelar"
              triggerClassName="h-8 bg-card/70 px-3 text-xs"
            />
          ) : null}
        </div>
      </div>
      {receipt.status === "PENDING" || receipt.status === "OVERDUE" ? (
        <WhatsAppReminderButton
          ref={whatsappRef}
          receiptId={receipt.id}
          showTrigger={false}
          demoPreview={isDemo ? { clientName: receipt.client.fullName, receiptNumber: receipt.receiptNumber, policyNumber: receipt.policy.policyNumber } : undefined}
        />
      ) : null}
      {receipt.qualitasEligible && receipt.qualitasEnabled ? (
        <QualitasPaymentLinkDialog
          receipt={{
            id: receipt.id,
            receiptNumber: receipt.receiptNumber,
            dueDate: receipt.dueDate,
            amount: receipt.amount,
            currency: receipt.currency,
            client: { fullName: receipt.client.fullName, email: receipt.clientEmail, phone: receipt.clientPhone },
            policy: { policyNumber: receipt.policy.policyNumber },
            insurer: { name: receipt.insurer.name },
          }}
          agent={{ email: receipt.agentEmail ?? null, phone: receipt.agentPhone ?? null }}
          enabled={Boolean(receipt.qualitasEnabled)}
          clientRecipientEnabled={Boolean(receipt.qualitasClientRecipientEnabled)}
          triggerMode="controlled"
          open={dialogAction === "qualitas-payment"}
          onOpenChange={(open) => setDialogAction(open ? "qualitas-payment" : null)}
        />
      ) : null}
      {receipt.qualitasMonitorEligible && qualitasMonitorFeatureEnabled ? (
        <QualitasReceiptMonitorPanel
          policyId={receipt.policy.id}
          policyNumber={receipt.policy.policyNumber}
          monitorEnabled={receipt.policy.qualitasReceiptMonitorEnabled}
          featureEnabled={qualitasMonitorFeatureEnabled}
          triggerMode="controlled"
          open={dialogAction === "qualitas-monitor"}
          onOpenChange={(open) => setDialogAction(open ? "qualitas-monitor" : null)}
        />
      ) : null}
    </div>
  );
}
