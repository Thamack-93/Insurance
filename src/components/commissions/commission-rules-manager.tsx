"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid, FormSection } from "@/components/forms/form-primitives";
import { PAYMENT_FREQUENCIES, POLICY_TYPES } from "@/lib/domain-values";
import { parseCommissionRules, type CommissionRule } from "@/lib/commissions.logic";
import { saveCommissionRuleAction } from "@/app/(dashboard)/commissions/rules/actions";
import type { CommissionRuleFormValues } from "@/lib/validations";

type InsurerInput = { id: string; name: string; commissionRules: unknown; commissionRulesVersion: number };

function emptyRule(insurerId: string, expectedVersion: number): CommissionRuleFormValues {
  return { id: "", insurerId, policyType: "AUTO", productPlan: "*", policyMode: "*", unitClass: "*", paymentFrequency: "*", rate: 0, validFrom: new Date().toISOString().slice(0, 10), validTo: "", active: false, evidence: "", expectedVersion };
}

export function CommissionRulesManager({ insurers: initialInsurers }: { insurers: InsurerInput[] }) {
  const [insurers, setInsurers] = useState(initialInsurers);
  const [insurerId, setInsurerId] = useState(initialInsurers[0]?.id ?? "");
  const [form, setForm] = useState<CommissionRuleFormValues>(() => emptyRule(initialInsurers[0]?.id ?? "", initialInsurers[0]?.commissionRulesVersion ?? 1));
  const [isPending, startTransition] = useTransition();
  const selectedInsurer = insurers.find((insurer) => insurer.id === insurerId);
  const rules = useMemo(() => parseCommissionRules(selectedInsurer?.commissionRules), [selectedInsurer]);

  function change<K extends keyof CommissionRuleFormValues>(key: K, value: CommissionRuleFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseInsurer(nextId: string) {
    setInsurerId(nextId);
    const next = insurers.find((insurer) => insurer.id === nextId);
    setForm(emptyRule(nextId, next?.commissionRulesVersion ?? 1));
  }

  function editRule(rule: CommissionRule) {
    setForm({ ...rule, policyType: rule.policyType as CommissionRuleFormValues["policyType"], insurerId, validTo: rule.validTo ?? "", expectedVersion: selectedInsurer?.commissionRulesVersion ?? 1 });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCommissionRuleAction(form);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(result.message);
      setInsurers((current) => current.map((insurer) => insurer.id === insurerId
        ? { ...insurer, commissionRules: [...rules.filter((rule) => rule.id !== (form.id || "")), { ...form, id: form.id || result.id, validTo: form.validTo || null }], commissionRulesVersion: insurer.commissionRulesVersion + 1 }
        : insurer));
      const updated = insurers.find((insurer) => insurer.id === insurerId);
      setForm(emptyRule(insurerId, (updated?.commissionRulesVersion ?? 0) + 1));
    });
  }

  if (!insurers.length) return <p className="text-sm text-muted-foreground">Agrega una aseguradora antes de configurar reglas.</p>;

  return (
    <div className="space-y-6">
      <FormSection title="Reglas vigentes y candidatas" description="Una combinación más específica gana. Usa * solo cuando la regla aplique a cualquier valor de esa dimensión. Las reglas nuevas quedan inactivas hasta respaldarlas con evidencia.">
        <FormField label="Aseguradora">
          <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={insurerId} onChange={(event) => chooseInsurer(event.target.value)}>
            {insurers.map((insurer) => <option key={insurer.id} value={insurer.id}>{insurer.name}</option>)}
          </select>
        </FormField>
        <div className="space-y-2">
          {!rules.length ? <p className="text-sm text-muted-foreground">No hay reglas configuradas. Los estados mensuales sirven como evidencia para proponerlas, pero no se activan porcentajes sin identificar sus dimensiones.</p> : null}
          {rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span>{rule.policyType} · {rule.productPlan} · {rule.policyMode} · {rule.unitClass} · {rule.paymentFrequency} · {rule.rate}% · {rule.active ? "Activa" : "Inactiva"}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => editRule(rule)}>Editar</Button>
            </div>
          ))}
        </div>
      </FormSection>

      <form onSubmit={save}>
        <FormSection title={form.id ? "Editar regla" : "Nueva regla"} description="La tasa aplica a la prima neta: prima total menos IVA, expedición y recargo fraccionado, más los descuentos visibles.">
          <FormGrid>
            <FormField label="Ramo">
              <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.policyType} onChange={(event) => change("policyType", event.target.value as CommissionRuleFormValues["policyType"])}>
                {POLICY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </FormField>
            <FormField label="Producto o plan"><Input value={form.productPlan} onChange={(event) => change("productPlan", event.target.value)} required /></FormField>
            <FormField label="Modalidad">
              {form.policyType === "AUTO" ? <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.policyMode} onChange={(event) => change("policyMode", event.target.value)} required>
                <option value="*">Cualquiera (*)</option><option value="INDIVIDUAL">Individual</option><option value="FLOTILLA">Flotilla</option>
                {!['*', 'INDIVIDUAL', 'FLOTILLA'].includes(form.policyMode.toUpperCase()) ? <option value={form.policyMode}>{form.policyMode} (actual)</option> : null}
              </select> : <Input value={form.policyMode} onChange={(event) => change("policyMode", event.target.value)} required placeholder="INDIVIDUAL, FLOTILLA o *" />}
            </FormField>
            <FormField label="Clase de riesgo / bien / persona">
              {form.policyType === "AUTO" ? <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.unitClass} onChange={(event) => change("unitClass", event.target.value)} required>
                <option value="*">Cualquier unidad (*)</option><option value="AUTO_PARTICULAR">Auto particular</option><option value="CAMION_CARGA">Camión / carga</option><option value="TRACTOCAMION">Tractocamión</option><option value="MOTOCICLETA">Motocicleta</option><option value="AUTOBUS">Autobús</option><option value="OTRO">Otro</option>
                {!['*', 'AUTO_PARTICULAR', 'CAMION_CARGA', 'TRACTOCAMION', 'MOTOCICLETA', 'AUTOBUS', 'OTRO'].includes(form.unitClass.toUpperCase()) ? <option value={form.unitClass}>{form.unitClass} (actual)</option> : null}
              </select> : <Input value={form.unitClass} onChange={(event) => change("unitClass", event.target.value)} required placeholder="PERSONA, INMUEBLE, CARGA, MOTO u otra clase; * si aplica a todas" />}
            </FormField>
            <FormField label="Frecuencia">
              <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentFrequency} onChange={(event) => change("paymentFrequency", event.target.value)}>
                <option value="*">Cualquiera (*)</option>{PAYMENT_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
              </select>
            </FormField>
            <FormField label="Tasa (%)"><Input type="number" min="0.01" max="100" step="0.01" value={form.rate || ""} onChange={(event) => change("rate", Number(event.target.value))} required /></FormField>
            <FormField label="Vigente desde"><Input type="date" value={form.validFrom} onChange={(event) => change("validFrom", event.target.value)} required /></FormField>
            <FormField label="Vigente hasta"><Input type="date" value={form.validTo} onChange={(event) => change("validTo", event.target.value)} /></FormField>
          </FormGrid>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(event) => change("active", event.target.checked)} />Activar esta regla</label>
          <FormField label="Evidencia o fuente"><textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.evidence} onChange={(event) => change("evidence", event.target.value)} maxLength={1000} placeholder="Acuerdo, tarifa o movimientos del estado que respaldan la tasa" /></FormField>
          <div className="flex justify-end gap-2">
            {form.id ? <Button type="button" variant="outline" onClick={() => setForm(emptyRule(insurerId, selectedInsurer?.commissionRulesVersion ?? 1))}>Cancelar edición</Button> : null}
            <Button type="submit" disabled={isPending}>{isPending ? "Guardando…" : "Guardar regla"}</Button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
