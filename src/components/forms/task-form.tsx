"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createTaskDefaults } from "@/lib/form-defaults";
import {
  priorityOptions,
  taskStatusOptions,
  taskTypeOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { formatDateInput } from "@/lib/form-utils";
import { taskSchema, type TaskFormValues } from "@/lib/validations";
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

type TaskFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: TaskFormValues;
  clientOptions: SelectOption[];
  policyOptions: SelectOption[];
  insurerOptions: SelectOption[];
  receiptOptions: SelectOption[];
  submitAction: (values: TaskFormValues) => Promise<MutationResult>;
};

export function TaskForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  policyOptions,
  insurerOptions,
  receiptOptions,
  submitAction,
}: TaskFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: TaskFormValues) {
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
          <FormSection title="Pendiente" description="Trabajo operativo, seguimiento o bloqueo a resolver.">
            <FormGrid>
              <FormField label="Título" htmlFor="title" error={errors.title?.message} className="md:col-span-2">
                <Input id="title" {...register("title")} />
              </FormField>

              <FormField label="Tipo" error={errors.taskType?.message}>
                <Controller
                  name="taskType"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Selecciona un tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypeOptions.map((option) => (
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
                        {taskStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField label="Prioridad" error={errors.priority?.message}>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(value) => field.onChange(value)}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Selecciona una prioridad" />
                      </SelectTrigger>
                      <SelectContent>
                        {priorityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Sin cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {clientOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>

              <FormField label="Póliza" error={errors.policyId?.message}>
                <Controller
                  name="policyId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Sin póliza" />
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

              <FormField label="Aseguradora" error={errors.insurerId?.message}>
                <Controller
                  name="insurerId"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Sin aseguradora" />
                      </SelectTrigger>
                      <SelectContent>
                        {insurerOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                    <Select value={field.value || null} onValueChange={(value) => field.onChange(value ?? "")}>
                      <SelectTrigger className="h-10 w-full rounded-xl bg-white">
                        <SelectValue placeholder="Sin recibo" />
                      </SelectTrigger>
                      <SelectContent>
                        {receiptOptions.map((option) => (
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