"use client";

import { useState, useTransition } from "react";
import { CircleDollarSign, CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPlatformPlanAction,
  assignPlatformSubscriptionAction,
  recordPlatformChargeAction,
  transitionPlatformChargeAction,
} from "@/app/(dashboard)/platform/billing-actions";
import type { PlatformBillingDetail, PlatformBillingOverview } from "@/lib/platform-billing";
import { formatMinorAmount } from "@/lib/platform-billing.logic";

function totals(value: Record<string, number>) {
  const entries = Object.entries(value);
  return entries.length ? entries.map(([currency, amount]) => formatMinorAmount(amount, currency)).join(" · ") : "—";
}

function requestId() {
  return crypto.randomUUID();
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(value));
}

function statusLabel(status: string) {
  return ({ TRIAL: "Trial", ACTIVE: "Activa", PAST_DUE: "Vencida", CANCELED: "Cancelada", PENDING: "Pendiente", PAID: "Pagado", VOID: "Anulado", REFUNDED: "Reembolsado" } as Record<string, string>)[status] ?? status;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby={title.replaceAll(" ", "-")}><div className="border-b p-4"><h2 id={title.replaceAll(" ", "-")} className="font-semibold">{title}</h2>{description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}</div>{children}</section>;
}

export function PlatformBillingPanel({ overview }: { overview: PlatformBillingOverview }) {
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState({ code: "", name: "", amount: "", currency: "MXN" });

  function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createPlatformPlanAction({ requestId: requestId(), code: plan.code, name: plan.name, monthlyAmountMinor: plan.amount, currency: plan.currency });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setPlan({ code: "", name: "", amount: "", currency: "MXN" });
    });
  }

  return <div className="space-y-6">
    <Section title="Billing interno de plataforma" description="MRR contratado y cargos de organizaciones. Se muestran por moneda y no se convierten entre sí.">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="MRR vigente" value={totals(overview.currentMrrByCurrency)} icon={CreditCard} />
        <Metric label="Cobrado este mes" value={totals(overview.cashThisMonthByCurrency)} icon={CircleDollarSign} />
        <Metric label="Suscripciones vigentes" value={String(overview.currentSubscriptionCount)} icon={ShieldCheck} />
        <Metric label="Cargos pendientes" value={String(overview.pendingChargeCount)} icon={RefreshCw} />
      </div>
      <div className="overflow-x-auto border-t p-4">
        <table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-2">Mes</th><th className="px-2 py-2">MRR</th><th className="px-2 py-2">Cobrado</th></tr></thead><tbody className="divide-y">{overview.monthlyTrend.map((month) => <tr key={month.month}><td className="px-2 py-2 font-medium">{month.month}</td><td className="px-2 py-2">{totals(month.mrrByCurrency)}</td><td className="px-2 py-2">{totals(month.cashByCurrency)}</td></tr>)}</tbody></table>
      </div>
    </Section>

    <Section title="Catálogo de planes" description="Los importes son unidades menores de moneda; crear un plan no cobra automáticamente.">
      {overview.mutationsEnabled ? <form onSubmit={createPlan} className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Código"><Input value={plan.code} onChange={(event) => setPlan({ ...plan, code: event.target.value.toUpperCase() })} placeholder="PRO" required maxLength={32} /></Field>
        <Field label="Nombre"><Input value={plan.name} onChange={(event) => setPlan({ ...plan, name: event.target.value })} placeholder="Profesional" required maxLength={120} /></Field>
        <Field label="Importe menor"><Input type="number" min="0" step="1" value={plan.amount} onChange={(event) => setPlan({ ...plan, amount: event.target.value })} required /></Field>
        <Field label="Moneda"><Input value={plan.currency} onChange={(event) => setPlan({ ...plan, currency: event.target.value.toUpperCase() })} maxLength={3} required /></Field>
        <div className="flex items-end"><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Crear plan"}</Button></div>
      </form> : <ReadOnlyNotice />}
      {overview.plans.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No hay planes activos.</p> : <div className="divide-y">{overview.plans.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><div><p className="font-medium">{item.code} · {item.name}</p><p className="text-xs text-muted-foreground">{item.active ? "Activo" : "Inactivo"}</p></div><span>{formatMinorAmount(item.monthlyAmountMinor, item.currency)} / mes</span></div>)}</div>}
    </Section>
  </div>;
}

export function PlatformOrganizationBillingPanel({ organizationId, detail }: { organizationId: string; detail: PlatformBillingDetail }) {
  const [pending, startTransition] = useTransition();
  const [subscription, setSubscription] = useState({ planId: "", status: "ACTIVE", reason: "" });
  const [charge, setCharge] = useState({ periodStart: "", periodEnd: "", amount: "", currency: "MXN", status: "PENDING", externalReference: "", reason: "" });

  function assignSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await assignPlatformSubscriptionAction({ requestId: requestId(), organizationId, planId: subscription.planId, status: subscription.status, reason: subscription.reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setSubscription({ planId: "", status: "ACTIVE", reason: "" });
    });
  }

  function recordCharge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await recordPlatformChargeAction({ requestId: requestId(), organizationId, periodStart: charge.periodStart, periodEnd: charge.periodEnd, amountMinor: charge.amount, currency: charge.currency, status: charge.status, externalReference: charge.externalReference, reason: charge.reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setCharge({ periodStart: "", periodEnd: "", amount: "", currency: "MXN", status: "PENDING", externalReference: "", reason: "" });
    });
  }

  function transitionCharge(chargeId: string, status: "PAID" | "VOID" | "REFUNDED") {
    startTransition(async () => {
      const result = await transitionPlatformChargeAction({ requestId: requestId(), chargeId, status, reason: `Cambio manual de estado a ${status}.` });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
    });
  }

  return <div className="space-y-6">
    <Section title="Billing de la organización" description="Las operaciones quedan registradas en PlatformAuditLog y reemplazan la suscripción vigente dentro de una transacción.">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"><Metric label="MRR actual" value={totals((detail.monthlyTrend.at(-1)?.mrrByCurrency) ?? {})} icon={CreditCard} /><Metric label="Cobrado este mes" value={totals((detail.monthlyTrend.at(-1)?.cashByCurrency) ?? {})} icon={CircleDollarSign} /><Metric label="Meses visibles" value={String(detail.monthlyTrend.length)} icon={RefreshCw} /></div>
      <div className="overflow-x-auto border-t p-4"><table className="w-full min-w-[640px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-2">Mes</th><th className="px-2 py-2">MRR</th><th className="px-2 py-2">Cobrado</th></tr></thead><tbody className="divide-y">{detail.monthlyTrend.map((month) => <tr key={month.month}><td className="px-2 py-2 font-medium">{month.month}</td><td className="px-2 py-2">{totals(month.mrrByCurrency)}</td><td className="px-2 py-2">{totals(month.cashByCurrency)}</td></tr>)}</tbody></table></div>
    </Section>

    <Section title="Suscripción" description="Solo puede existir una suscripción vigente por organización.">
      {detail.mutationsEnabled ? <form onSubmit={assignSubscription} className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Plan"><select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={subscription.planId} onChange={(event) => setSubscription({ ...subscription, planId: event.target.value })} required><option value="">Selecciona un plan</option>{detail.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code} · {formatMinorAmount(plan.monthlyAmountMinor, plan.currency)}</option>)}</select></Field>
        <Field label="Estado"><select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={subscription.status} onChange={(event) => setSubscription({ ...subscription, status: event.target.value })}><option value="TRIAL">Trial</option><option value="ACTIVE">Activa</option></select></Field>
        <Field label="Motivo"><Input value={subscription.reason} onChange={(event) => setSubscription({ ...subscription, reason: event.target.value })} minLength={10} maxLength={500} required placeholder="Alta o cambio autorizado" /></Field>
        <div className="flex items-end"><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Asignar"}</Button></div>
      </form> : <ReadOnlyNotice />}
      {detail.subscriptions.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No hay suscripciones registradas.</p> : <div className="divide-y">{detail.subscriptions.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"><div><p className="font-medium">{item.plan.code} · {item.plan.name}</p><p className="text-xs text-muted-foreground">{statusLabel(item.status)} · inicia {formatDate(item.startedAt)}{item.endsAt ? ` · termina ${formatDate(item.endsAt)}` : ""}</p></div><span>{formatMinorAmount(item.monthlyAmountMinor, item.currency)} / mes</span></div>)}</div>}
    </Section>

    <Section title="Cargos" description="Solo un cargo PAID con paidAt cuenta como cash cobrado. Las correcciones requieren transición y motivo.">
      {detail.mutationsEnabled ? <form onSubmit={recordCharge} className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Inicio"><Input type="date" value={charge.periodStart} onChange={(event) => setCharge({ ...charge, periodStart: event.target.value })} required /></Field>
        <Field label="Fin"><Input type="date" value={charge.periodEnd} onChange={(event) => setCharge({ ...charge, periodEnd: event.target.value })} required /></Field>
        <Field label="Importe menor"><Input type="number" min="0" step="1" value={charge.amount} onChange={(event) => setCharge({ ...charge, amount: event.target.value })} required /></Field>
        <Field label="Moneda"><Input value={charge.currency} onChange={(event) => setCharge({ ...charge, currency: event.target.value.toUpperCase() })} maxLength={3} required /></Field>
        <Field label="Estado inicial"><select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={charge.status} onChange={(event) => setCharge({ ...charge, status: event.target.value })}><option value="PENDING">Pendiente</option><option value="PAID">Pagado</option></select></Field>
        <Field label="Referencia externa"><Input value={charge.externalReference} onChange={(event) => setCharge({ ...charge, externalReference: event.target.value })} maxLength={200} /></Field>
        <Field label="Motivo" className="sm:col-span-2"><Input value={charge.reason} onChange={(event) => setCharge({ ...charge, reason: event.target.value })} minLength={10} maxLength={500} required placeholder="Cargo mensual acordado" /></Field>
        <div className="flex items-end"><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Registrar cargo"}</Button></div>
      </form> : <ReadOnlyNotice />}
      {detail.charges.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No hay cargos registrados.</p> : <div className="divide-y">{detail.charges.map((item) => <div key={item.id} className="flex flex-col gap-3 p-4 text-sm lg:flex-row lg:items-center lg:justify-between"><div><p className="font-medium">{formatMinorAmount(item.amountMinor, item.currency)} · {statusLabel(item.status)}</p><p className="text-xs text-muted-foreground">{formatDate(item.periodStart)} a {formatDate(item.periodEnd)} · {item.reason}{item.externalReference ? ` · ref. ${item.externalReference}` : ""}</p></div>{detail.mutationsEnabled ? <div className="flex flex-wrap gap-2">{item.status === "PENDING" ? <><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => transitionCharge(item.id, "PAID")}>Marcar pagado</Button><Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => transitionCharge(item.id, "VOID")}>Anular</Button></> : null}{item.status === "PAID" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => transitionCharge(item.id, "REFUNDED")}>Reembolsar</Button> : null}</div> : null}</div>)}</div>}
    </Section>
  </div>;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1 text-sm font-medium ${className ?? ""}`}>{label}{children}</label>;
}

function ReadOnlyNotice() {
  return <p className="border-b bg-muted/30 p-4 text-sm text-muted-foreground">Billing está en modo lectura. Las mutaciones se habilitarán después de completar la validación del entorno temporal.</p>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CreditCard }) {
  return <div className="rounded-xl border bg-card p-4"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}
