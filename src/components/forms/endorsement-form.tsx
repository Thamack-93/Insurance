"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { endorsementStatusOptions, currencyOptions } from "@/lib/domain-options";
import { endorsementSchema, type EndorsementFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ControlledSelect,
  FormActions,
  FormErrorBanner,
  FormField,
  FormGrid,
  FormSection,
} from "@/components/forms/form-primitives";

type EndorsementFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: EndorsementFormValues;
  submitAction: (values: EndorsementFormValues) => Promise<MutationResult>;
  policySummary?: ReactNode;
};

export function EndorsementForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  submitAction,
  policySummary,
}: EndorsementFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EndorsementFormValues>({
    resolver: zodResolver(endorsementSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: EndorsementFormValues) {
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
    <Card className="border-border/70 bg-card/88 shadow-sm">
      <CardHeader className="border-b border-border/70">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <FormErrorBanner message={errors.root?.message} />

        {policySummary ? <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">{policySummary}</div> : null}

        <form className="space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("policyId")} />

          <FormSection title="Identidad del endoso" description="Se mantiene ligado a una sola póliza base.">
            <FormGrid>
              <FormField label="Número de endoso" htmlFor="endorsementNumber" error={errors.endorsementNumber?.message}>
                <Input id="endorsementNumber" autoFocus {...register("endorsementNumber")} />
              </FormField>

              <FormField label="Estado" error={errors.status?.message}>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={endorsementStatusOptions}
                      placeholder="Selecciona un estado"
                    />
                  )}
                />
              </FormField>

              <FormField label="Importe" htmlFor="amount" error={errors.amount?.message}>
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
            </FormGrid>
          </FormSection>

          <FormSection title="Vigencia del endoso" description="Fechas de efecto y vencimiento del ajuste.">
            <FormGrid>
              <FormField label="Inicio" htmlFor="startDate" error={errors.startDate?.message}>
                <Input id="startDate" type="date" {...register("startDate")} />
              </FormField>

              <FormField label="Fin" htmlFor="endDate" error={errors.endDate?.message}>
                <Input id="endDate" type="date" {...register("endDate")} />
              </FormField>

              <FormField label="Referencia" htmlFor="reference" error={errors.reference?.message}>
                <Input id="reference" {...register("reference")} />
              </FormField>

              <FormField label="Concepto" htmlFor="concept" error={errors.concept?.message}>
                <Input id="concept" {...register("concept")} />
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
