"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { createPayment } from "@/app/(dashboard)/payments/actions";

type QuickPaymentDialogProps = {
  receipt: {
    id: string;
    receiptNumber: string;
    amount: number;
    currency: string;
    dueDate: string;
    client: { fullName: string };
    policy: { policyNumber: string };
  };
  onPaymentComplete?: () => void;
};

export function QuickPaymentDialog({ receipt, onPaymentComplete }: QuickPaymentDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleQuickPayment = () => {
    startTransition(async () => {
      const result = await createPayment({
        receiptId: receipt.id,
        amount: receipt.amount,
        paidDate: new Date().toISOString().split("T")[0],
        paymentMethod: "TRANSFER",
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-2" />}>
        <CreditCard className="h-4 w-4" />
        Pagar
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Pago Rápido
          </DialogTitle>
          <DialogDescription>
            Confirma el pago para el recibo {receipt.receiptNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-stone-50 p-4">
            <div className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recibo:</span>
                <span className="font-medium">{receipt.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span className="font-medium">{receipt.client.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Póliza:</span>
                <span className="font-medium">{receipt.policy.policyNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vencimiento:</span>
                <span className="font-medium">{formatDate(receipt.dueDate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Estado:</span>
                <Badge variant={new Date(receipt.dueDate) < new Date() ? "destructive" : "secondary"}>
                  {new Date(receipt.dueDate) < new Date() ? "Vencido" : "Pendiente"}
                </Badge>
              </div>
              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">Monto a pagar:</span>
                  <span className="text-lg font-bold text-green-600">
                    {formatCurrency(receipt.amount, receipt.currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <p>• El pago se registrará con la fecha actual</p>
              <p>• Método de pago: Transferencia bancaria</p>
              <p>• El recibo se marcará como pagado</p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleQuickPayment}
              disabled={isPending}
              className="flex-1"
            >
              {isPending
                ? "Procesando..."
                : `Pagar ${formatCurrency(receipt.amount, receipt.currency)}`}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
