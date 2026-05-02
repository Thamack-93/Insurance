"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

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
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleQuickPayment = async () => {
    setIsProcessing(true);
    
    try {
      const response = await fetch("/api/payments/quick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receiptId: receipt.id,
          amount: receipt.amount,
          paidDate: new Date().toISOString().split("T")[0],
          paymentMethod: "TRANSFER",
        }),
      });

      if (response.ok) {
        setIsOpen(false);
        onPaymentComplete?.();
        // Show success message
        window.location.reload();
      } else {
        throw new Error("Error al procesar el pago");
      }
    } catch (error) {
      console.error("Quick payment error:", error);
      // Show error message
    } finally {
      setIsProcessing(false);
    }
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
                    {formatCurrency(receipt.amount)}
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
              disabled={isProcessing}
              className="flex-1"
            >
              {isProcessing ? "Procesando..." : `Pagar ${formatCurrency(receipt.amount)}`}
            </Button>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
