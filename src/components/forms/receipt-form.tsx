"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createReceiptDefaults } from "@/lib/form-defaults";
import {
  currencyOptions,
  receiptStatusOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { formatDateInput } from "@/lib/form-utils";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
  submitAction: (values: ReceiptFormValues) => Promise<MutationResult>;
};

export function ReceiptForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  policyOptions,
  submitAction,
}: ReceiptFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
    <Card className="border-white/70 bg-white/88 shadow-sm shadow-stone-200/70">
      <CardHeader className="border-b border-stone-200/80">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <FormErrorBanner message={errors.root?.message} />

        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <FormSection title="Identidad financiera" description="El recibo representa una obligación de cobro.">
            <FormGrid>
              <FormField label="Número de recibo" htmlFor="receiptNumber" error={errors.receiptNumber?.message}>
                <Input id="receiptNumber" {...register("receiptNumber")} />
              </FormField>

              <FormField label="Póliza" error={errors.policyId?.message}>
                <Controller
                  name="policyId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Selecciona una póliza" />
                      </SelectTrigger>
                      <SelectContent>
                        {policyOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField label="Monto" htmlFor="amount" error={errors.amount?.message}>
                <Input id="amount" type="number" min="0" step="0.01" {...register("amount")} />
              </FormField>

              <FormField label="Moneda" error={errors.currency?.message}>
                <Controller
                  name="currency"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Selecciona una moneda" />
                      </SelectTrigger>
                      <SelectContent>
                        {currencyOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField label="Estado" error={errors.status?.message}>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Selecciona un estado" />
                      </SelectTrigger>
                      <SelectContent>
                        {receiptStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
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

          <FormActions cancelHref={cancelHref} submitLabel={submitLabel} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}