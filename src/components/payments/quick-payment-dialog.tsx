"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlledSelect } from "@/components/forms/form-primitives";
import { CreditCard, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/money";
import { formatDate, isOverdue, today } from "@/lib/dates";
import { formatDateInput } from "@/lib/form-utils";
import { parseBusinessDateInput } from "@/lib/business-dates";
import { paymentMethodOptions } from "@/lib/domain-options";
import { Badge } from "@/components/ui/badge";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { cn } from "@/lib/utils";

type QuickPaymentDialogProps = {
  receipt: {
    id: string;
    receiptNumber: string;
    originLabel?: string;
    amount: number;
    currency: string;
    dueDate: string;
    client: { fullName: string };
    policy: { policyNumber: string };
    endorsement?: { endorsementNumber: string; reference?: string | null };
  };
  onPaymentComplete?: () => void;
  className?: string;
  initialOpen?: boolean;
};

export function QuickPaymentDialog({ receipt, onPaymentComplete, className, initialOpen = false }: QuickPaymentDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isPending, startTransition] = useTransition();
  const [paidDate, setPaidDate] = useState(formatDateInput(today()));
  const [paymentMethod, setPaymentMethod] = useState("TRANSFER");
  const [step, setStep] = useState<"review" | "confirm">("review");
  const selectedPaymentMethod = paymentMethodOptions.find((option) => option.value === paymentMethod)?.label ?? paymentMethod;

  const handleQuickPayment = () => {
    startTransition(async () => {
      const result = await createPayment({
        receiptId: receipt.id,
        amount: receipt.amount,
        paidDate,
        paymentMethod,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      setIsOpen(false);
      onPaymentComplete?.();
      router.refresh();
    });
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setPaidDate(formatDateInput(today()));
      setPaymentMethod("TRANSFER");
      setStep("review");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className={cn("gap-2", className)} />}>
        <CreditCard className="h-4 w-4" />
        Registrar pago
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {step === "review" ? "Registrar pago" : "Confirmar pago"}
          </DialogTitle>
          <DialogDescription>
            {step === "review"
              ? `Revisa el importe, la fecha y el método para el recibo ${receipt.receiptNumber}.`
              : `Confirma que deseas registrar el pago del recibo ${receipt.receiptNumber}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "review" ? <>
          <div className="rounded-md bg-muted/40 p-4">
            <div className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Recibo:</span>
                <span className="font-medium">{receipt.receiptNumber}</span>
              </div>
              {receipt.originLabel ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Origen:</span>
                  <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                    {receipt.originLabel}
                  </Badge>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span className="font-medium">{receipt.client.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Póliza:</span>
                <span className="font-medium">{receipt.policy.policyNumber}</span>
              </div>
              {receipt.endorsement ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Endoso:</span>
                  <span className="font-medium">#{receipt.endorsement.endorsementNumber}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vencimiento:</span>
                <span className="font-medium">{formatDate(receipt.dueDate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Estado:</span>
                <Badge variant={isOverdue(parseBusinessDateInput(receipt.dueDate)) ? "destructive" : "secondary"}>
                  {isOverdue(parseBusinessDateInput(receipt.dueDate)) ? "Vencido" : "Pendiente"}
                </Badge>
              </div>
              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Importe del recibo</span>
                  <span className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {formatCurrency(receipt.amount, receipt.currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`paid-date-${receipt.id}`}>Fecha de pago</label>
              <Input id={`paid-date-${receipt.id}`} type="date" required value={paidDate} onChange={(event) => setPaidDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`payment-method-${receipt.id}`}>Método de pago</label>
              <ControlledSelect
                id={`payment-method-${receipt.id}`}
                value={paymentMethod}
                onValueChange={setPaymentMethod}
                options={paymentMethodOptions}
                aria-label="Método de pago"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Esta acción registra el importe completo del recibo; no permite abonos.</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
            <Button onClick={() => setStep("confirm")} disabled={!paidDate} className="sm:min-w-40">Revisar pago</Button>
          </div>
          </> : <>
          <div className="rounded-lg border bg-muted/30 p-4">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Recibo</dt><dd className="font-medium">{receipt.receiptNumber}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cliente</dt><dd className="text-right font-medium">{receipt.client.fullName}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Importe</dt><dd className="font-semibold tabular-nums">{formatCurrency(receipt.amount, receipt.currency)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Método</dt><dd className="font-medium">{selectedPaymentMethod}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Fecha</dt><dd className="font-medium">{formatDate(parseBusinessDateInput(paidDate))}</dd></div>
            </dl>
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Saldo restante al completar</span>
              <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(0, receipt.currency)}</span>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setStep("review")} disabled={isPending}>Volver a revisar</Button>
            <Button
              onClick={handleQuickPayment}
              disabled={isPending}
              className="sm:min-w-40"
              aria-label={`Confirmar pago de ${formatCurrency(receipt.amount, receipt.currency)}`}
            >
              {isPending
                ? "Registrando..."
                : "Confirmar pago"}
            </Button>
          </div>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
