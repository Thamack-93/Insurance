"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useTransition, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
  policyAssets: Record<string, Array<{ id: string; description: string; unitClass: string | null }>>;
  endorsementOptionsByPolicy?: Record<string, SelectOption[]>;
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
  policyAssets,
  endorsementOptionsByPolicy,
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
    setValue,
    getValues,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptSchema) as never,
    defaultValues,
  });
  const selectedPolicyId = useWatch({ control, name: "policyId" });
  const vatAmount = useWatch({ control, name: "vatAmount" });
  const issuanceExpenseAmount = useWatch({ control, name: "issuanceExpenseAmount" });
  const surchargeAmount = useWatch({ control, name: "surchargeAmount" });
  const discountAmount = useWatch({ control, name: "discountAmount" });
  const selectedEndorsementOptions = endorsementOptionsByPolicy?.[selectedPolicyId ?? ""] ?? [];
  const selectedAssets = useMemo(() => selectedPolicyId ? policyAssets[selectedPolicyId] ?? [] : [], [selectedPolicyId, policyAssets]);

  useEffect(() => {
    if (selectedAssets.length <= 1) {
      if (selectedAssets.length === 1) {
        const legacyUnit = getValues("premiumBreakdownByUnit").find((row) => row.insuredAssetId === selectedAssets[0].id);
        const aggregateFields = [
          ["vatAmount", "vatAmount"],
          ["issuanceExpenseAmount", "issuanceExpenseAmount"],
          ["surchargeAmount", "surchargeAmount"],
          ["discountAmount", "discountAmount"],
        ] as const;
        // Move legacy single-unit values into receipt-level fields when needed.
        // Keep any legacy row until the aggregate fields are complete so editing
        // an older receipt never discards its only captured component values.
        if (legacyUnit) {
          for (const [receiptField, unitField] of aggregateFields) {
            const current = getValues(receiptField);
            if ((current === "" || current === undefined) && legacyUnit[unitField] !== "" && legacyUnit[unitField] !== undefined) {
              setValue(receiptField, legacyUnit[unitField]);
            }
          }
          const aggregateIsComplete = aggregateFields.every(([receiptField]) => {
            const value = getValues(receiptField);
            return value !== "" && value !== undefined;
          });
          setValue("premiumBreakdownByUnit", aggregateIsComplete ? [] : [legacyUnit]);
        } else {
          setValue("premiumBreakdownByUnit", []);
        }
      } else {
        setValue("premiumBreakdownByUnit", []);
      }
      return;
    }
    const existing = new Map(getValues("premiumBreakdownByUnit").map((field) => [field.insuredAssetId, field]));
    setValue("premiumBreakdownByUnit", selectedAssets.map((asset) => {
      const saved = existing.get(asset.id);
      return saved ?? { insuredAssetId: asset.id, totalPremium: "", vatAmount: "", issuanceExpenseAmount: "", surchargeAmount: "", discountAmount: "" };
    }));
  }, [selectedPolicyId, selectedAssets, vatAmount, issuanceExpenseAmount, surchargeAmount, discountAmount, setValue, getValues]);

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
                      onValueChange={(value) => {
                        if (value !== field.value) setValue("endorsementId", "");
                        field.onChange(value);
                      }}
                      options={policyOptions}
                      placeholder="Selecciona una póliza"
                    />
                  )}
                />
              </FormField>

              {selectedEndorsementOptions.length > 0 ? (
                <FormField label="Endoso" error={errors.endorsementId?.message}>
                  <Controller
                    name="endorsementId"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        options={selectedEndorsementOptions}
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
                    <StatusBadge status={defaultValues.status} entity="receipt" />
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

          <FormSection title="Ajuste excepcional del recibo" description="El desglose normal se captura una sola vez en la póliza y se distribuye automáticamente. Usa estos campos solo si el documento de este recibo muestra importes distintos al reparto generado; prima total − IVA − expedición − recargo + descuentos = prima neta.">
            {selectedAssets.length > 1 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Solo hace falta separar por bien o persona cuando el documento lo respalda y las reglas de comisión cambian según su clasificación.</p>
                {selectedAssets.map((asset, index) => (
                  <div key={asset.id} className="rounded-lg border p-4">
                    <p className="mb-3 text-sm font-medium">{asset.description || `Riesgo ${index + 1}`} · {asset.unitClass || "Clase asegurable pendiente"}</p>
                    <input type="hidden" {...register(`premiumBreakdownByUnit.${index}.insuredAssetId`)} />
                    <FormGrid>
                      <FormField label="Prima total" htmlFor={`premium-unit-${index}-total`}><Input id={`premium-unit-${index}-total`} type="number" min="0" step="0.01" {...register(`premiumBreakdownByUnit.${index}.totalPremium`)} /></FormField>
                      <FormField label="IVA" htmlFor={`premium-unit-${index}-iva`}><Input id={`premium-unit-${index}-iva`} type="number" min="0" step="0.01" {...register(`premiumBreakdownByUnit.${index}.vatAmount`)} /></FormField>
                      <FormField label="Gastos de expedición" htmlFor={`premium-unit-${index}-issue`}><Input id={`premium-unit-${index}-issue`} type="number" min="0" step="0.01" {...register(`premiumBreakdownByUnit.${index}.issuanceExpenseAmount`)} /></FormField>
                      <FormField label="Recargo fraccionado" htmlFor={`premium-unit-${index}-surcharge`}><Input id={`premium-unit-${index}-surcharge`} type="number" min="0" step="0.01" {...register(`premiumBreakdownByUnit.${index}.surchargeAmount`)} /></FormField>
                      <FormField label="Descuentos visibles (suma)" htmlFor={`premium-unit-${index}-discount`}><Input id={`premium-unit-${index}-discount`} type="number" min="0" step="0.01" {...register(`premiumBreakdownByUnit.${index}.discountAmount`)} /></FormField>
                    </FormGrid>
                  </div>
                ))}
              </div>
            ) : (
              <FormGrid>
                <p className="text-sm text-muted-foreground">El importe del recibo es la prima total; captura solo conceptos que difieran del reparto de la póliza y estén visibles en este recibo.</p>
                <FormField label="IVA" htmlFor="vatAmount"><Input id="vatAmount" type="number" min="0" step="0.01" {...register("vatAmount")} /></FormField>
                <FormField label="Gastos de expedición" htmlFor="issuanceExpenseAmount"><Input id="issuanceExpenseAmount" type="number" min="0" step="0.01" {...register("issuanceExpenseAmount")} /></FormField>
                <FormField label="Recargo fraccionado" htmlFor="surchargeAmount"><Input id="surchargeAmount" type="number" min="0" step="0.01" {...register("surchargeAmount")} /></FormField>
                <FormField label="Descuentos visibles (suma)" htmlFor="discountAmount"><Input id="discountAmount" type="number" min="0" step="0.01" {...register("discountAmount")} /></FormField>
              </FormGrid>
            )}
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
