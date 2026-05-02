"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, toNumber } from "@/lib/money";
import { today, formatDate } from "@/lib/dates";

const paymentSchema = z.object({
  receiptId: z.string().min(1, "El recibo es requerido"),
  amount: z.number().min(0.01, "El monto debe ser mayor a 0"),
  paidDate: z.string().min(1, "La fecha de pago es requerida"),
  paymentMethod: z.string().min(1, "El método de pago es requerido"),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

type PaymentFormProps = {
  receipts: Array<{
    id: string;
    receiptNumber: string;
    amount: number;
    currency: string;
    client: { fullName: string };
    policy: { policyNumber: string };
  }>;
  onSubmit: (data: PaymentFormValues) => Promise<void>;
  onCancel?: () => void;
};

export function PaymentForm({ receipts, onSubmit, onCancel }: PaymentFormProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedReceipt, setSelectedReceipt] = useState<string>("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema) as never,
    defaultValues: {
      paidDate: formatDate(today()),
      paymentMethod: "TRANSFER",
    },
  });

  const selectedReceiptId = watch("receiptId");
  const selectedReceiptData = receipts.find(r => r.id === selectedReceiptId);

  const handleReceiptChange = (receiptId: string) => {
    setSelectedReceipt(receiptId);
    const receipt = receipts.find(r => r.id === receiptId);
    if (receipt) {
      setValue("amount", receipt.amount);
    }
  };

  const onFormSubmit = (data: any) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success("Pago registrado exitosamente");
      } catch (error) {
        toast.error("Error al registrar el pago");
      }
    });
  };

  const paymentMethods = [
    { value: "TRANSFER", label: "Transferencia bancaria" },
    { value: "CASH", label: "Efectivo" },
    { value: "CHECK", label: "Cheque" },
    { value: "CARD", label: "Tarjeta de crédito/débito" },
    { value: "OTHER", label: "Otro" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar Pago</CardTitle>
        <CardDescription>
          Registra un pago para un recibo pendiente. El recibo se marcará como pagado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="receiptId">Recibo</Label>
              <Select
                value={selectedReceiptId}
                onValueChange={(value) => handleReceiptChange(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar recibo" />
                </SelectTrigger>
                <SelectContent>
                  {receipts.map((receipt) => (
                    <SelectItem key={receipt.id} value={receipt.id}>
                      {receipt.receiptNumber} - {receipt.client.fullName} - {formatCurrency(receipt.amount)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.receiptId && (
                <p className="text-sm text-red-500">{errors.receiptId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Monto</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register("amount", { valueAsNumber: true })}
                disabled={!!selectedReceiptData}
              />
              {selectedReceiptData && (
                <p className="text-sm text-muted-foreground">
                  Monto original: {formatCurrency(selectedReceiptData.amount)}
                </p>
              )}
              {errors.amount && (
                <p className="text-sm text-red-500">{errors.amount.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paidDate">Fecha de pago</Label>
              <Input
                id="paidDate"
                type="date"
                {...register("paidDate")}
              />
              {errors.paidDate && (
                <p className="text-sm text-red-500">{errors.paidDate.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Método de pago</Label>
              <Select
                value={watch("paymentMethod")}
                onValueChange={(value) => setValue("paymentMethod", value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar método" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.paymentMethod && (
                <p className="text-sm text-red-500">{errors.paymentMethod.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">Referencia (opcional)</Label>
            <Input
              id="reference"
              placeholder="Número de referencia, folio, etc."
              {...register("reference")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Notas adicionales sobre el pago"
              {...register("notes")}
            />
          </div>

          {selectedReceiptData && (
            <div className="rounded-lg bg-stone-50 p-4">
              <h4 className="font-medium mb-2">Resumen del recibo</h4>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recibo:</span>
                  <span>{selectedReceiptData.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente:</span>
                  <span>{selectedReceiptData.client.fullName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Póliza:</span>
                  <span>{selectedReceiptData.policy.policyNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monto:</span>
                  <span>{formatCurrency(selectedReceiptData.amount)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Registrando..." : "Registrar pago"}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
