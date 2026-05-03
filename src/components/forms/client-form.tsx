"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  clientTypeOptions,
  entityStatusOptions,
} from "@/lib/domain-options";
import { clientSchema, type ClientFormValues } from "@/lib/validations";
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

type ClientFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: ClientFormValues;
  submitAction: (values: ClientFormValues) => Promise<MutationResult>;
};

export function ClientForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  submitAction,
}: ClientFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: ClientFormValues) {
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
          <FormSection title="Perfil" description="Datos principales del expediente del cliente.">
            <FormGrid>
              <FormField label="Nombre completo" htmlFor="fullName" error={errors.fullName?.message}>
                <Input id="fullName" autoFocus {...register("fullName")} />
              </FormField>

              <FormField label="Tipo" error={errors.type?.message}>
                <Controller
                  name="type"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={clientTypeOptions}
                      placeholder="Selecciona un tipo"
                    />
                  )}
                />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Contacto" description="Canales y datos para operar la cuenta.">
            <FormGrid>
              <FormField label="Email" htmlFor="email" error={errors.email?.message}>
                <Input id="email" type="email" {...register("email")} />
              </FormField>

              <FormField label="Teléfono" htmlFor="phone" error={errors.phone?.message}>
                <Input id="phone" {...register("phone")} />
              </FormField>

              <FormField label="Teléfono secundario" htmlFor="secondaryPhone" error={errors.secondaryPhone?.message}>
                <Input id="secondaryPhone" {...register("secondaryPhone")} />
              </FormField>

              <FormField
                label="Método preferido"
                htmlFor="preferredContactMethod"
                error={errors.preferredContactMethod?.message}
              >
                <Input id="preferredContactMethod" {...register("preferredContactMethod")} />
              </FormField>

              <FormField label="RFC" htmlFor="rfc" error={errors.rfc?.message}>
                <Input id="rfc" {...register("rfc")} />
              </FormField>

              <FormField label="Estado" error={errors.status?.message}>
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={entityStatusOptions}
                      placeholder="Selecciona un estado"
                    />
                  )}
                />
              </FormField>
            </FormGrid>

            <FormField label="Dirección" htmlFor="address" error={errors.address?.message}>
              <Textarea id="address" rows={3} {...register("address")} />
            </FormField>
          </FormSection>

          <FormSection title="Notas" description="Contexto útil para la operación diaria.">
            <FormField label="Notas internas" htmlFor="notes" error={errors.notes?.message}>
              <Textarea id="notes" rows={5} {...register("notes")} />
            </FormField>
          </FormSection>

          <FormActions cancelHref={cancelHref} submitLabel={submitLabel} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}
