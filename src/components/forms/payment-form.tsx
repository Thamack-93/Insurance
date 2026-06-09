"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ControlledSelect,
  FormErrorBanner,
  FormField,
  FormGrid,
} from "@/components/forms/form-primitives";
import { paymentMethodOptions } from "@/lib/domain-options";
import { formatCurrency } from "@/lib/money";
import { today, formatDate } from "@/lib/dates";
import type { MutationResult } from "@/lib/mutation-utils";

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
  submitAction: (data: PaymentFormValues) => Promise<MutationResult>;
  cancelHref?: string;
};

export function PaymentForm({ receipts, submitAction, cancelHref }: PaymentFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema) as never,
    defaultValues: {
      receiptId: "",
      paidDate: formatDate(today()),
      paymentMethod: "TRANSFER",
    },
  });

  const selectedReceiptId = useWatch({ control, name: "receiptId" });
  const selectedPaymentMethod = useWatch({ control, name: "paymentMethod" });
  const selectedReceiptData = receipts.find((r) => r.id === selectedReceiptId);

  const receiptOptions = receipts.map((r) => ({
    value: r.id,
    label: `${r.receiptNumber} – ${r.client.fullName} – ${formatCurrency(r.amount)}`,
  }));

  const handleReceiptChange = (receiptId: string) => {
    setValue("receiptId", receiptId);
    const receipt = receipts.find((r) => r.id === receiptId);
    if (receipt) {
      setValue("amount", receipt.amount);
    }
  };

  const onFormSubmit = (data: PaymentFormValues) => {
    startTransition(async () => {
      const result = await submitAction(data);
      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.push(result.redirectTo || "/payments");
    });
  };

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
          <FormErrorBanner message={errors.root?.message} />

          <FormGrid>
            <FormField label="Recibo" required error={errors.receiptId?.message}>
              <ControlledSelect
                value={selectedReceiptId || ""}
                onValueChange={handleReceiptChange}
                options={receiptOptions}
                placeholder="Seleccionar recibo"
                autoFocus
              />
            </FormField>

            <FormField
              label="Monto"
              htmlFor="amount"
              required
              error={errors.amount?.message}
              hint={
                selectedReceiptData
                  ? `Monto original: ${formatCurrency(selectedReceiptData.amount)}`
                  : undefined
              }
            >
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register("amount", { valueAsNumber: true })}
                disabled={!!selectedReceiptData}
              />
            </FormField>
          </FormGrid>

          <FormGrid>
            <FormField label="Fecha de pago" htmlFor="paidDate" required error={errors.paidDate?.message}>
              <Input id="paidDate" type="date" {...register("paidDate")} />
            </FormField>

            <FormField label="Método de pago" required error={errors.paymentMethod?.message}>
                <ControlledSelect
                  value={selectedPaymentMethod || ""}
                  onValueChange={(value) => setValue("paymentMethod", value ?? "")}
                  options={paymentMethodOptions}
                  placeholder="Seleccionar método"
                />
              </FormField>
          </FormGrid>

          <FormField label="Referencia (opcional)" htmlFor="reference" error={errors.reference?.message}>
            <Input id="reference" placeholder="Número de referencia, folio, etc." {...register("reference")} />
          </FormField>

          <FormField label="Notas (opcional)" htmlFor="notes" error={errors.notes?.message}>
            <Textarea id="notes" placeholder="Notas adicionales sobre el pago" {...register("notes")} />
          </FormField>

          {selectedReceiptData && (
            <div className="rounded-lg bg-muted/40 p-4">
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
            {cancelHref && (
              <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
