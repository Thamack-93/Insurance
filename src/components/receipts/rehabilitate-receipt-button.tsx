"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, RotateCcw } from "lucide-react";
import { rehabilitatePayment } from "@/app/(dashboard)/payments/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDateInput } from "@/lib/form-utils";
import { today } from "@/lib/dates";

type RehabilitateReceiptButtonProps = {
  receiptId: string;
  receiptNumber: string;
  amount: number;
  currency: string;
};

export function RehabilitateReceiptButton({ receiptId, receiptNumber, amount, currency }: RehabilitateReceiptButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState(String(amount));
  const [paidDate, setPaidDate] = useState(formatDateInput(today()));
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await rehabilitatePayment({
        receiptId,
        amount: Number(paidAmount),
        paidDate,
        paymentMethod: "TRANSFER",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="bg-card/70" />}>
        <RotateCcw className="mr-2 size-4" />
        Rehabilitar y pagar
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-5" />
            Rehabilitar recibo {receiptNumber}
          </DialogTitle>
          <DialogDescription>
            El pago reactivará la póliza y reabrirá los demás recibos cancelados por falta de pago.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            Importe del recibo: <strong>{formatCurrency(amount, currency)}</strong>. Se permite una diferencia máxima de $5.
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`rehab-amount-${receiptId}`}>Monto pagado</label>
            <Input id={`rehab-amount-${receiptId}`} type="number" min="0.01" step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium" htmlFor={`rehab-date-${receiptId}`}>
              <CalendarClock className="size-4" /> Fecha de pago
            </label>
            <Input id={`rehab-date-${receiptId}`} type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button className="flex-1" disabled={isPending} onClick={submit}>
              {isPending ? "Procesando..." : "Registrar y rehabilitar"}
            </Button>
            <Button variant="outline" disabled={isPending} onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
