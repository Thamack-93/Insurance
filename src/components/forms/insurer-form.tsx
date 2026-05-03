"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createInsurerDefaults } from "@/lib/form-defaults";
import { entityStatusOptions } from "@/lib/domain-options";
import { insurerSchema, type InsurerFormValues } from "@/lib/validations";
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

type InsurerFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: InsurerFormValues;
  submitAction: (values: InsurerFormValues) => Promise<MutationResult>;
};

export function InsurerForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  submitAction,
}: InsurerFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InsurerFormValues>({
    resolver: zodResolver(insurerSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: InsurerFormValues) {
    startTransition(async () => {
      const result = await submitAction(values);

      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.push("/insurers");
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
            <FormSection title="Información general" description="Datos básicos de la aseguradora.">
              <FormField label="Nombre" error={errors.name?.message} hint="Campo obligatorio">
                <Input autoFocus {...register("name")} placeholder="Ej: AXA Seguros" />
              </FormField>

              <FormField label="Portal URL" error={errors.portalUrl?.message}>
                <Input {...register("portalUrl")} placeholder="https://..." />
              </FormField>

              <FormField label="Estado" error={errors.status?.message} hint="Campo obligatorio">
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={entityStatusOptions}
                      placeholder="Selecciona estado"
                    />
                  )}
                />
              </FormField>
            </FormSection>

            <FormSection title="Contacto" description="Información de contacto comercial.">
              <FormField label="Nombre de contacto" error={errors.contactName?.message}>
                <Input {...register("contactName")} placeholder="Ej: Juan Pérez" />
              </FormField>

              <FormField label="Email de contacto" error={errors.contactEmail?.message}>
                <Input {...register("contactEmail")} type="email" placeholder="correo@ejemplo.com" />
              </FormField>

              <FormField label="Teléfono de contacto" error={errors.contactPhone?.message}>
                <Input {...register("contactPhone")} placeholder="+52 55 1234 5678" />
              </FormField>
            </FormSection>

            <FormSection title="Notas" description="Información adicional interna.">
              <FormField label="Notas" error={errors.notes?.message}>
                <Textarea {...register("notes")} rows={4} placeholder="Notas internas sobre la aseguradora..." />
              </FormField>
            </FormSection>
          </FormGrid>

          <FormActions submitLabel={submitLabel} cancelHref={cancelHref} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}

export { createInsurerDefaults };
