"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createQuoteDefaults } from "@/lib/form-defaults";
import {
  policyTypeOptions,
  quoteStatusOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { quoteSchema, type QuoteFormValues } from "@/lib/validations";
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

type QuoteFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: QuoteFormValues;
  clientOptions: SelectOption[];
  insurerOptions: SelectOption[];
  submitAction: (values: QuoteFormValues) => Promise<MutationResult>;
};

export function QuoteForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  insurerOptions,
  submitAction,
}: QuoteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: QuoteFormValues) {
    startTransition(async () => {
      const result = await submitAction(values);

      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.push("/quotes");
    });
  }

  return (
    <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <FormErrorBanner message={errors.root?.message} />

          <FormGrid>
            <FormSection title="Información de la cotización" description="Datos básicos de la propuesta.">
              <FormField label="Cliente" error={errors.clientId?.message} hint="Campo obligatorio">
                <Select {...register("clientId")} defaultValue={defaultValues.clientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientOptions.map((option: SelectOption) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Aseguradora" error={errors.insurerId?.message}>
                <Select {...register("insurerId")} defaultValue={defaultValues.insurerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona aseguradora (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {insurerOptions.map((option: SelectOption) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Tipo de póliza" error={errors.policyType?.message} hint="Campo obligatorio">
                <Select {...register("policyType")} defaultValue={defaultValues.policyType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {policyTypeOptions.map((option: SelectOption) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Estado" error={errors.status?.message} hint="Campo obligatorio">
                <Select {...register("status")} defaultValue={defaultValues.status}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {quoteStatusOptions.map((option: SelectOption) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </FormSection>

            <FormSection title="Fechas" description="Timeline de la cotización.">
              <FormField label="Fecha de solicitud" error={errors.requestedDate?.message} hint="Campo obligatorio">
                <Input {...register("requestedDate")} type="date" />
              </FormField>

              <FormField label="Fecha de envío" error={errors.sentDate?.message}>
                <Input {...register("sentDate")} type="date" />
              </FormField>

              <FormField label="Válida hasta" error={errors.validUntil?.message}>
                <Input {...register("validUntil")} type="date" />
              </FormField>
            </FormSection>

            <FormSection title="Valores" description="Información económica.">
              <FormField label="Monto cotizado" error={errors.quotedAmount?.message}>
                <Input {...register("quotedAmount")} type="number" step="0.01" placeholder="0.00" />
              </FormField>
            </FormSection>

            <FormSection title="Descripción" description="Detalles adicionales de la cotización.">
              <FormField label="Notas" error={errors.notes?.message}>
                <Textarea {...register("notes")} rows={4} placeholder="Notas internas sobre la cotización..." />
              </FormField>
            </FormSection>
          </FormGrid>

          <FormActions submitLabel={submitLabel} cancelHref={cancelHref} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}

export { createQuoteDefaults };
