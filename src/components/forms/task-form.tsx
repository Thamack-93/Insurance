"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  priorityOptions,
  workItemStatusOptions,
  workItemTypeOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { workItemSchema, type WorkItemFormValues } from "@/lib/validations";
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

type WorkItemFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: WorkItemFormValues;
  clientOptions: SelectOption[];
  insurerOptions: SelectOption[];
  submitAction: (values: WorkItemFormValues) => Promise<MutationResult>;
};

type RelationOptionsResponse = {
  policies: SelectOption[];
  receipts: SelectOption[];
};

type LoadedPolicyOptions = { clientId: string; options: SelectOption[] };
type LoadedReceiptOptions = { policyId: string; options: SelectOption[] };

export function WorkItemForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  insurerOptions,
  submitAction,
}: WorkItemFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<WorkItemFormValues>({
    resolver: zodResolver(workItemSchema) as never,
    defaultValues,
  });
  const clientId = useWatch({ control, name: "clientId" }) || "";
  const policyId = useWatch({ control, name: "policyId" }) || "";
  const initialClientId = defaultValues.clientId || "";
  const initialPolicyId = defaultValues.policyId || "";
  const initialReceiptId = defaultValues.receiptId || "";
  const [loadedPolicyOptions, setLoadedPolicyOptions] = useState<LoadedPolicyOptions>({ clientId: "", options: [] });
  const [loadedReceiptOptions, setLoadedReceiptOptions] = useState<LoadedReceiptOptions>({ policyId: "", options: [] });
  const policyOptions = loadedPolicyOptions.clientId === clientId ? loadedPolicyOptions.options : [];
  const receiptOptions = loadedReceiptOptions.policyId === policyId ? loadedReceiptOptions.options : [];
  const loadingPolicyOptions = Boolean(clientId) && loadedPolicyOptions.clientId !== clientId;
  const loadingReceiptOptions = Boolean(policyId) && loadedReceiptOptions.policyId !== policyId;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (!clientId) {
      return () => {
        active = false;
        controller.abort();
      };
    }

    const params = new URLSearchParams();
    params.set("clientId", clientId);
    if (initialClientId === clientId && initialPolicyId) params.set("selectedPolicyId", initialPolicyId);

    fetch(`/api/work-items/relation-options?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las relaciones.");
        return response.json() as Promise<RelationOptionsResponse>;
      })
      .then((options) => {
        if (!active) return;
        setLoadedPolicyOptions({ clientId, options: Array.isArray(options.policies) ? options.policies : [] });
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setLoadedPolicyOptions({ clientId, options: [] });
          toast.error("No se pudieron cargar las pólizas de este cliente.");
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [clientId, initialClientId, initialPolicyId]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (!policyId) {
      return () => {
        active = false;
        controller.abort();
      };
    }

    const params = new URLSearchParams({ policyId });
    if (initialPolicyId === policyId && initialReceiptId) params.set("selectedReceiptId", initialReceiptId);
    fetch(`/api/work-items/relation-options?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar los recibos relacionados.");
        return response.json() as Promise<RelationOptionsResponse>;
      })
      .then((options) => {
        if (!active) return;
        setLoadedReceiptOptions({ policyId, options: Array.isArray(options.receipts) ? options.receipts : [] });
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setLoadedReceiptOptions({ policyId, options: [] });
          toast.error("No se pudieron cargar los recibos de esta póliza.");
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialPolicyId, initialReceiptId, policyId]);

  async function onSubmit(values: WorkItemFormValues) {
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
          <FormSection title="Pendiente" description="Trabajo operativo, seguimiento o bloqueo a resolver.">
            <FormGrid>
              <FormField label="Título" htmlFor="title" error={errors.title?.message} className="md:col-span-2">
                <Input id="title" autoFocus {...register("title")} />
              </FormField>

              <FormField label="Tipo" error={errors.taskType?.message}>
                <Controller
                  name="taskType"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={workItemTypeOptions}
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
                      options={workItemStatusOptions}
                      placeholder="Selecciona un estado"
                    />
                  )}
                />
              </FormField>

              <FormField label="Prioridad" error={errors.priority?.message}>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={priorityOptions}
                      placeholder="Selecciona una prioridad"
                    />
                  )}
                />
              </FormField>

              <FormField label="Inicio" htmlFor="startDate" error={errors.startDate?.message}>
                <Input id="startDate" type="date" {...register("startDate")} />
              </FormField>

              <FormField label="Vence" htmlFor="dueDate" error={errors.dueDate?.message}>
                <Input id="dueDate" type="date" {...register("dueDate")} />
              </FormField>
            </FormGrid>

            <FormField label="Descripción" htmlFor="description" error={errors.description?.message}>
              <Textarea id="description" rows={4} {...register("description")} />
            </FormField>
          </FormSection>

          <FormSection title="Relaciones" description="Puedes ligar el pendiente a cliente, póliza, recibo o aseguradora.">
            <FormGrid>
              <FormField label="Cliente" error={errors.clientId?.message}>
                <Controller
                  name="clientId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value || ""}
                      onValueChange={(value) => {
                        const nextClientId = value ?? "";
                        setValue("policyId", "", { shouldDirty: true, shouldValidate: true });
                        setValue("receiptId", "", { shouldDirty: true, shouldValidate: true });
                        field.onChange(nextClientId);
                      }}
                      options={clientOptions}
                      placeholder="Sin cliente"
                    />
                  )}
                />
              </FormField>

              <FormField label="Póliza" error={errors.policyId?.message}>
                <Controller
                  name="policyId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value || ""}
                      onValueChange={(value) => {
                        setValue("receiptId", "", { shouldDirty: true, shouldValidate: true });
                        field.onChange(value ?? "");
                      }}
                      options={policyOptions}
                      placeholder={
                        !clientId ? "Selecciona un cliente primero"
                          : loadingPolicyOptions ? "Cargando pólizas..."
                            : "Sin póliza"
                      }
                      disabled={!clientId || loadingPolicyOptions}
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
                      value={field.value || ""}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      options={insurerOptions}
                      placeholder="Sin aseguradora"
                    />
                  )}
                />
              </FormField>

              <FormField
                label="Recibo"
                error={errors.receiptId?.message}
                hint="Si eliges un recibo, el sistema prioriza sus relaciones financieras."
              >
                <Controller
                  name="receiptId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value || ""}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      options={receiptOptions}
                      placeholder={
                        !policyId ? "Selecciona una póliza primero"
                          : loadingReceiptOptions ? "Cargando recibos..."
                            : "Sin recibo"
                      }
                      disabled={!policyId || loadingReceiptOptions}
                    />
                  )}
                />
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
