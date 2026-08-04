"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMinorAmount } from "@/lib/platform-metrics";
import { assignPlanAction, recordChargeAction, setOrganizationStatusAction, updateMembershipAction } from "@/app/(dashboard)/platform/actions";

type Detail = Awaited<ReturnType<typeof import("@/lib/platform-dashboard").getPlatformOrganization>>;
type Plans = Awaited<ReturnType<typeof import("@/lib/platform-dashboard").getPlatformPlans>>;

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? "Guardando…" : children}</Button>;
}

export function PlatformOrganizationDetail({ detail, plans }: { detail: NonNullable<Detail>; plans: Plans }) {
  const activeSubscription = detail.subscriptions.find((subscription) => ["ACTIVE", "TRIAL"].includes(subscription.status));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><Link href="/platform" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Plataforma</Link><h1 className="mt-2 font-heading text-3xl font-semibold">{detail.name}</h1><p className="text-sm text-muted-foreground">{detail.slug} · {detail.status}</p></div><form action={setOrganizationStatusAction}><input type="hidden" name="organizationId" value={detail.id} /><input type="hidden" name="status" value={detail.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} /><SubmitButton>{detail.status === "ACTIVE" ? "Suspender" : "Reactivar"}</SubmitButton></form></div>
      <nav aria-label="Secciones de organización" className="flex flex-wrap gap-2 border-b pb-2 text-sm"><a href="#summary" className="rounded-md px-3 py-1.5 hover:bg-muted">Resumen</a><a href="#users" className="rounded-md px-3 py-1.5 hover:bg-muted">Usuarios</a><a href="#subscription" className="rounded-md px-3 py-1.5 hover:bg-muted">Suscripción</a><a href="#revenue" className="rounded-md px-3 py-1.5 hover:bg-muted">Ingresos</a><a href="#audit" className="rounded-md px-3 py-1.5 hover:bg-muted">Auditoría</a></nav>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card id="summary"><CardHeader><CardTitle>Resumen</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p><strong>Zona horaria:</strong> {detail.timeZone}</p><p><strong>Moneda:</strong> {detail.defaultCurrency}</p><p><strong>Membresías:</strong> {detail.memberships.filter((membership) => membership.active).length} activas de {detail.memberships.length}</p><p><strong>Plan actual:</strong> {activeSubscription?.plan.name ?? "Sin suscripción"}</p></CardContent></Card>
        <Card id="subscription"><CardHeader><CardTitle>Suscripción</CardTitle></CardHeader><CardContent className="space-y-3"><form action={assignPlanAction} className="flex flex-wrap gap-2"><input type="hidden" name="organizationId" value={detail.id} /><select name="planId" className="h-8 rounded-lg border bg-background px-2 text-sm" required><option value="">Seleccionar plan</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code} · {formatMinorAmount(plan.monthlyAmountMinor, plan.currency)}</option>)}</select><select name="status" className="h-8 rounded-lg border bg-background px-2 text-sm" defaultValue="ACTIVE"><option value="TRIAL">Trial</option><option value="ACTIVE">Activo</option><option value="PAST_DUE">Vencido</option><option value="CANCELED">Cancelado</option></select><SubmitButton>Asignar</SubmitButton></form>{detail.subscriptions.map((subscription) => <div key={subscription.id} className="rounded-lg border p-2 text-sm"><span className="font-medium">{subscription.plan.name}</span> · {subscription.status} · {formatMinorAmount(subscription.monthlyAmountMinor, subscription.currency)}</div>)}</CardContent></Card>
      </div>
      <Card id="users"><CardHeader><CardTitle>Usuarios y memberships</CardTitle></CardHeader><CardContent className="space-y-3">{detail.memberships.map((membership) => <div key={membership.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><div><p className="font-medium">{membership.user.name}</p><p className="text-xs text-muted-foreground">{membership.user.email} · {membership.active ? "Activo" : "Inactivo"}</p></div></div><form action={updateMembershipAction} className="flex items-center gap-2"><input type="hidden" name="organizationId" value={detail.id} /><input type="hidden" name="userId" value={membership.user.id} /><select name="role" defaultValue={membership.role} className="h-8 rounded-lg border bg-background px-2 text-sm"><option>OWNER</option><option>ADMIN</option><option>AGENT</option></select><input type="hidden" name="active" value={membership.active ? "true" : "false"} /><SubmitButton>Guardar</SubmitButton></form></div>)}</CardContent></Card>
      <Card id="revenue"><CardHeader><CardTitle>Ingresos y correcciones</CardTitle></CardHeader><CardContent><form action={recordChargeAction} className="grid gap-2 md:grid-cols-5"><input type="hidden" name="organizationId" value={detail.id} /><Input name="amountMinor" type="number" min={0} placeholder="Importe menor" required /><Input name="currency" defaultValue={detail.defaultCurrency} maxLength={3} /><select name="status" defaultValue="PAID" className="h-8 rounded-lg border bg-background px-2 text-sm"><option>PAID</option><option>VOID</option><option>REFUNDED</option></select><Input name="reason" placeholder="Motivo obligatorio" required /><SubmitButton>Registrar cargo</SubmitButton></form><div className="mt-4 space-y-2">{detail.charges.map((charge) => <div key={charge.id} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{new Date(charge.periodStart).toLocaleDateString("es-MX")} · {charge.status}</span><span className="font-medium">{formatMinorAmount(charge.amountMinor, charge.currency)}</span><span className="text-muted-foreground">{charge.reason}</span></div>)}</div></CardContent></Card>
      <Card id="audit"><CardHeader><CardTitle>Auditoría de plataforma</CardTitle></CardHeader><CardContent><div className="space-y-2 text-sm">{detail.activity.length ? detail.activity.map((entry) => <div key={entry.id} className="border-b py-2"><span className="font-medium">{entry.action}</span> · {new Date(entry.createdAt).toLocaleString("es-MX")}<p className="text-xs text-muted-foreground">{entry.entityType} / {entry.entityId}</p></div>) : <p className="text-muted-foreground">Sin eventos registrados.</p>}</div></CardContent></Card>
    </div>
  );
}
