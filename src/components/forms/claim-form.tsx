"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createClaimDefaults } from "@/lib/form-defaults";
import {
  claimStatusOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { claimSchema, type ClaimFormValues } from "@/lib/validations";
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

type ClaimFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: ClaimFormValues;
  clientOptions: SelectOption[];
  policyOptions: SelectOption[];
  insurerOptions: SelectOption[];
  submitAction: (values: ClaimFormValues) => Promise<MutationResult>;
};

export function ClaimForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  policyOptions,
  insurerOptions,
  submitAction,
}: ClaimFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: ClaimFormValues) {
    startTransition(async () => {
      const result = await submitAction(values);

      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.push("/claims");
    });
  }

  return (
    <Card className="border-border/70 bg-card/84 shadow-sm  backdrop-blur">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <FormErrorBanner message={errors.root?.message} />

          <FormGrid>
            <FormSection title="Información del siniestro" description="Datos básicos del reclamo.">
              <FormField label="Folio" error={errors.folio?.message} hint="Campo obligatorio">
                <Input autoFocus {...register("folio")} placeholder="Ej: SIN-2024-001" />
              </FormField>

              <FormField label="Tipo de siniestro" error={errors.claimType?.message} hint="Campo obligatorio">
                <Input {...register("claimType")} placeholder="Ej: Robo de vehículo" />
              </FormField>

              <FormField label="Estado" error={errors.status?.message} hint="Campo obligatorio">
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={claimStatusOptions}
                      placeholder="Selecciona estado"
                    />
                  )}
                />
              </FormField>
            </FormSection>

            <FormSection title="Vínculos" description="Entidades relacionadas al siniestro.">
              <FormField label="Cliente" error={errors.clientId?.message} hint="Campo obligatorio">
                <Controller
                  name="clientId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={clientOptions}
                      placeholder="Selecciona cliente"
                    />
                  )}
                />
              </FormField>

              <FormField label="Póliza" error={errors.policyId?.message} hint="Campo obligatorio">
                <Controller
                  name="policyId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={policyOptions}
                      placeholder="Selecciona póliza"
                    />
                  )}
                />
              </FormField>

              <FormField label="Aseguradora" error={errors.insurerId?.message} hint="Campo obligatorio">
                <Controller
                  name="insurerId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={insurerOptions}
                      placeholder="Selecciona aseguradora"
                    />
                  )}
                />
              </FormField>
            </FormSection>

            <FormSection title="Fechas" description="Timeline del siniestro.">
              <FormField label="Fecha del incidente" error={errors.incidentDate?.message} hint="Campo obligatorio">
                <Input {...register("incidentDate")} type="date" />
              </FormField>

              <FormField label="Fecha de reporte" error={errors.reportedDate?.message} hint="Campo obligatorio">
                <Input {...register("reportedDate")} type="date" />
              </FormField>

              <FormField label="Fecha de cierre" error={errors.closedDate?.message}>
                <Input {...register("closedDate")} type="date" />
              </FormField>
            </FormSection>

            <FormSection title="Montos" description="Valores económicos del reclamo.">
              <FormField label="Monto reclamado" error={errors.amountClaimed?.message}>
                <Input {...register("amountClaimed")} type="number" step="0.01" placeholder="0.00" />
              </FormField>

              <FormField label="Monto pagado" error={errors.amountPaid?.message}>
                <Input {...register("amountPaid")} type="number" step="0.01" placeholder="0.00" />
              </FormField>
            </FormSection>

            <FormSection title="Descripción" description="Detalles adicionales del siniestro.">
              <FormField label="Descripción" error={errors.description?.message}>
                <Textarea {...register("description")} rows={4} placeholder="Describe los detalles del incidente..." />
              </FormField>

              <FormField label="Notas internas" error={errors.notes?.message}>
                <Textarea {...register("notes")} rows={3} placeholder="Notas internas sobre el siniestro..." />
              </FormField>
            </FormSection>
          </FormGrid>

          <FormActions submitLabel={submitLabel} cancelHref={cancelHref} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}

export { createClaimDefaults };
