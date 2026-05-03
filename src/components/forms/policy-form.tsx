"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  currencyOptions,
  paymentFrequencyOptions,
  policyStatusOptions,
  policyTypeOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { policySchema, type PolicyFormValues } from "@/lib/validations";
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

type PolicyFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: PolicyFormValues;
  clientOptions: SelectOption[];
  insurerOptions: SelectOption[];
  submitAction: (values: PolicyFormValues) => Promise<MutationResult>;
};

export function PolicyForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  insurerOptions,
  submitAction,
}: PolicyFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PolicyFormValues>({
    resolver: zodResolver(policySchema) as never,
    defaultValues,
  });

  async function onSubmit(values: PolicyFormValues) {
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
          <FormSection title="Identidad de póliza" description="Relaciones y clasificación principal.">
            <FormGrid>
              <FormField label="Número de póliza" htmlFor="policyNumber" error={errors.policyNumber?.message}>
                <Input id="policyNumber" autoFocus {...register("policyNumber")} />
              </FormField>

              <FormField label="Cliente" error={errors.clientId?.message}>
                <Controller
                  name="clientId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={clientOptions}
                      placeholder="Selecciona un cliente"
                    />
                  )}
                />
              </FormField>

              <FormField label="Aseguradora" error={errors.insurerId?.message}>
                <Controller
                  name="insurerId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={insurerOptions}
                      placeholder="Selecciona una aseguradora"
                    />
                  )}
                />
              </FormField>

              <FormField label="Tipo" error={errors.policyType?.message}>
                <Controller
                  name="policyType"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={policyTypeOptions}
                      placeholder="Selecciona un tipo"
                    />
                  )}
                />
              </FormField>

              <FormField label="Estado" error={errors.status?.message}>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={policyStatusOptions}
                      placeholder="Selecciona un estado"
                    />
                  )}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Vigencia y cobro" description="Fechas y monetización de la cobertura.">
            <FormGrid>
              <FormField label="Inicio" htmlFor="startDate" error={errors.startDate?.message}>
                <Input id="startDate" type="date" {...register("startDate")} />
              </FormField>

              <FormField label="Fin" htmlFor="endDate" error={errors.endDate?.message}>
                <Input id="endDate" type="date" {...register("endDate")} />
              </FormField>

              <FormField label="Renovación" htmlFor="renewalDate" error={errors.renewalDate?.message}>
                <Input id="renewalDate" type="date" {...register("renewalDate")} />
              </FormField>

              <FormField label="Prima" htmlFor="premiumAmount" error={errors.premiumAmount?.message}>
                <Input id="premiumAmount" type="number" min="0" step="0.01" {...register("premiumAmount")} />
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

              <FormField label="Frecuencia de pago" error={errors.paymentFrequency?.message}>
                <Controller
                  name="paymentFrequency"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={paymentFrequencyOptions}
                      placeholder="Selecciona una frecuencia"
                    />
                  )}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Detalle comercial" description="Información útil para asesoría y renovación.">
            <FormGrid>
              <FormField label="Plan de pago" htmlFor="paymentPlan" error={errors.paymentPlan?.message}>
                <Input id="paymentPlan" {...register("paymentPlan")} />
              </FormField>

              <FormField label="Objeto asegurado" htmlFor="insuredObject" error={errors.insuredObject?.message}>
                <Input id="insuredObject" {...register("insuredObject")} />
              </FormField>
            </FormGrid>

            <FormField label="Beneficiarios" htmlFor="beneficiaryInfo" error={errors.beneficiaryInfo?.message}>
              <Textarea id="beneficiaryInfo" rows={4} {...register("beneficiaryInfo")} />
            </FormField>

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
