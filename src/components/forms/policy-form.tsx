"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import type { SerialRenewalCandidate } from "@/lib/policy-renewal-match";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PolicyRenewalSelector } from "@/components/policies/policy-renewal-selector";
import { PolicyRiskDetailsFields } from "@/components/forms/policy-risk-details-fields";
import { emptyPolicyRiskDetails } from "@/lib/policy-risk-details";
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
  renewalSource?: PolicyRenewalSource | null;
  showRenewalLink?: boolean;
  renewalSearchScope?: "portfolio" | "all";
  submitAction: (values: PolicyFormValues) => Promise<MutationResult>;
  riskDetailsNeedsReview?: boolean;
  findRenewalCandidates?: (input: { clientId: string; policyType: string; startDate: string; serialNumbers: string[] }) => Promise<SerialRenewalCandidate[]>;
};

export function PolicyForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  insurerOptions,
  renewalSource = null,
  showRenewalLink = false,
  renewalSearchScope = "portfolio",
  submitAction,
  riskDetailsNeedsReview = false,
  findRenewalCandidates,
}: PolicyFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<PolicyFormValues>({
    resolver: zodResolver(policySchema) as never,
    defaultValues,
  });
  const selectedPolicyType = useWatch({ control, name: "policyType" });
  const watchedClientId = useWatch({ control, name: "clientId" });
  const watchedStartDate = useWatch({ control, name: "startDate" });
  const watchedRiskDetails = useWatch({ control, name: "riskDetails" });
  const [renewedFromPolicyId, setRenewedFromPolicyId] = useState(defaultValues.renewedFromPolicyId ?? "");
  const [renewalCandidateResult, setRenewalCandidateResult] = useState<{ key: string; candidates: SerialRenewalCandidate[] } | null>(null);
  const vehicles = selectedPolicyType === "AUTO" && watchedRiskDetails && typeof watchedRiskDetails === "object"
    ? ((watchedRiskDetails as { data?: { vehicles?: Array<{ vin?: string }> } }).data?.vehicles ?? [])
    : [];
  const serialNumbers = vehicles.map((vehicle) => vehicle.vin?.trim() ?? "").filter(Boolean);
  const renewalCandidateKey = findRenewalCandidates && watchedClientId && watchedStartDate && serialNumbers.length
    ? JSON.stringify([watchedClientId, selectedPolicyType, watchedStartDate, serialNumbers])
    : "";

  useEffect(() => {
    if (!renewalCandidateKey || !findRenewalCandidates) return;
    const [clientId, policyType, startDate, serials] = JSON.parse(renewalCandidateKey) as [string, string, string, string[]];

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findRenewalCandidates({
        clientId,
        policyType,
        startDate,
        serialNumbers: serials,
      }).then((candidates) => {
        if (!cancelled) setRenewalCandidateResult({ key: renewalCandidateKey, candidates });
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [findRenewalCandidates, renewalCandidateKey]);

  const renewalCandidates = renewalCandidateResult?.key === renewalCandidateKey ? renewalCandidateResult.candidates : [];

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
          {riskDetailsNeedsReview ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              La descripción histórica se conservó porque no se pudo separar con confianza. Completa los campos del ramo y guarda para registrar los datos estructurados.
            </div>
          ) : null}
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
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (value !== field.value) {
                          setValue("riskDetails", emptyPolicyRiskDetails(value as PolicyFormValues["policyType"]), { shouldDirty: true, shouldValidate: true });
                        }
                      }}
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

          {showRenewalLink ? (
            <FormSection title="Renovación" description="Si esta póliza renueva otra, deja el vínculo capturado desde aquí.">
              <input type="hidden" {...register("renewedFromPolicyId")} />
              <PolicyRenewalSelector
                value={renewedFromPolicyId}
                onChange={(next) => {
                  setRenewedFromPolicyId(next);
                  setValue("renewedFromPolicyId", next, { shouldDirty: true, shouldValidate: true });
                }}
                selectedPolicy={renewalSource}
                suggestions={renewalCandidates}
                disabled={isPending}
                allowClear
                searchScope={renewalSearchScope}
              />
            </FormSection>
          ) : null}

          <Controller
            name="riskDetails"
            control={control}
            render={({ field }) => (
              <PolicyRiskDetailsFields policyType={selectedPolicyType} value={field.value} onChange={field.onChange} />
            )}
          />

          <FormSection title="Detalle comercial" description="Información útil para asesoría y renovación.">
            <FormGrid>
              <FormField label="Plan de pago" htmlFor="paymentPlan" error={errors.paymentPlan?.message}>
                <Input id="paymentPlan" {...register("paymentPlan")} />
              </FormField>

              <FormField
                label="Descripción anterior"
                htmlFor="insuredObject"
                hint="Se conserva para proteger la información histórica. Los datos estructurados generan la descripción actual."
              >
                <Input id="insuredObject" {...register("insuredObject")} readOnly />
              </FormField>
            </FormGrid>

            <FormField label={selectedPolicyType === "VIDA" ? "Beneficiarios anteriores" : "Beneficiarios / notas de beneficiarios"} htmlFor="beneficiaryInfo" error={errors.beneficiaryInfo?.message}>
              <Textarea id="beneficiaryInfo" rows={3} {...register("beneficiaryInfo")} readOnly={selectedPolicyType === "VIDA" || selectedPolicyType === "FIANZAS"} />
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
