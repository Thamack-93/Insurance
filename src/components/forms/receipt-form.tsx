"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  currencyOptions,
  paymentMethodOptions,
  receiptStatusOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/badges/status-badge";
import {
  ControlledSelect,
  FormActions,
  FormErrorBanner,
  FormField,
  FormGrid,
  FormSection,
} from "@/components/forms/form-primitives";

type ReceiptFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: ReceiptFormValues;
  policyOptions: SelectOption[];
  endorsementOptions?: SelectOption[];
  submitAction: (values: ReceiptFormValues) => Promise<MutationResult>;
  footerActions?: ReactNode;
};

export function ReceiptForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  policyOptions,
  endorsementOptions,
  submitAction,
  footerActions,
}: ReceiptFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const editableReceiptStatusOptions = receiptStatusOptions.filter((option) => option.value !== "CANCELLED");
  const isCancelled = defaultValues.status === "CANCELLED";
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: ReceiptFormValues) {
    startTransition(async () => {
      const result = await submitAction(values);

      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <Card className="border-border/70 bg-card/88 shadow-sm ">
      <CardHeader className="border-b border-border/70">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <FormErrorBanner message={errors.root?.message} />

        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <FormSection title="Identidad financiera" description="El recibo representa una obligación de cobro.">
            <FormGrid>
              <FormField label="Número de recibo" htmlFor="receiptNumber" error={errors.receiptNumber?.message}>
                <Input id="receiptNumber" autoFocus {...register("receiptNumber")} />
              </FormField>

              <FormField label="Póliza" error={errors.policyId?.message}>
                <Controller
                  name="policyId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={policyOptions}
                      placeholder="Selecciona una póliza"
                    />
                  )}
                />
              </FormField>

              {endorsementOptions && endorsementOptions.length > 0 ? (
                <FormField label="Endoso" error={errors.endorsementId?.message}>
                  <Controller
                    name="endorsementId"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        options={endorsementOptions}
                        placeholder="Selecciona un endoso"
                      />
                    )}
                  />
                </FormField>
              ) : (
                <input type="hidden" {...register("endorsementId")} />
              )}

              <FormField label="Monto" htmlFor="amount" error={errors.amount?.message}>
                <Input id="amount" type="number" min="0" step="0.01" {...register("amount")} />
              </FormField>

              <FormField label="Moneda" error={errors.currency?.message}>
                <Controller
                  name="currency"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={currencyOptions}
                      placeholder="Selecciona una moneda"
                    />
                  )}
                />
              </FormField>

              <FormField label="Estado" error={errors.status?.message}>
                {isCancelled ? (
                  <div className="flex min-h-10 items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                    <StatusBadge status={defaultValues.status} />
                    <span className="text-sm text-muted-foreground">Este recibo está cancelado y el estado no se edita desde aquí.</span>
                    <input type="hidden" {...register("status")} />
                  </div>
                ) : (
                  <Controller
                    name="status"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={field.value}
                        onValueChange={field.onChange}
                        options={editableReceiptStatusOptions}
                        placeholder="Selecciona un estado"
                      />
                    )}
                  />
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Periodo" description="Rango de cobertura del cobro y su vencimiento.">
            <FormGrid>
              <FormField label="Inicio de periodo" htmlFor="periodStartDate" error={errors.periodStartDate?.message}>
                <Input id="periodStartDate" type="date" {...register("periodStartDate")} />
              </FormField>

              <FormField label="Fin de periodo" htmlFor="periodEndDate" error={errors.periodEndDate?.message}>
                <Input id="periodEndDate" type="date" {...register("periodEndDate")} />
              </FormField>

              <FormField label="Vencimiento" htmlFor="dueDate" error={errors.dueDate?.message}>
                <Input id="dueDate" type="date" {...register("dueDate")} />
              </FormField>
            </FormGrid>

            <FormField label="Notas" htmlFor="notes" error={errors.notes?.message}>
              <Textarea id="notes" rows={5} {...register("notes")} />
            </FormField>
          </FormSection>

          <FormSection
            title="Cobro manual"
            description="Estos campos corrigen el recibo. No registran un pago nuevo ni crean conciliación."
          >
            <FormGrid>
              <FormField label="Fecha de pago" htmlFor="paidDate" error={errors.paidDate?.message}>
                <Input id="paidDate" type="date" {...register("paidDate")} />
              </FormField>

              <FormField label="Método de pago" error={errors.paymentMethod?.message}>
                <Controller
                  name="paymentMethod"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      options={paymentMethodOptions}
                      placeholder="Selecciona un método"
                    />
                  )}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormActions
            cancelHref={cancelHref}
            submitLabel={submitLabel}
            pending={isPending}
            leftContent={footerActions}
          />
        </form>
      </CardContent>
    </Card>
  );
}
