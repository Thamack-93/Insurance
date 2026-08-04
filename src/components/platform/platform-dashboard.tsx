"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Building2, CircleDollarSign, CreditCard, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinorAmount } from "@/lib/platform-metrics";
import type { PlatformOverview } from "@/lib/platform-dashboard";
import { createOrganizationAction, createPlanAction } from "@/app/(dashboard)/platform/actions";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Guardando…" : children}</Button>;
}

function totals(value: Record<string, number>) {
  const entries = Object.entries(value);
  return entries.length ? entries.map(([currency, amount]) => formatMinorAmount(amount, currency)).join(" · ") : "—";
}

export function PlatformDashboard({ overview }: { overview: PlatformOverview }) {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-primary">Control global</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Plataforma</h1><p className="mt-1 text-sm text-muted-foreground">Ciclo de vida, membresías y facturación interna por organización.</p></div>
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">Las operaciones de clientes, pólizas y pagos requieren contexto explícito de organización.</div>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4" /> Organizaciones</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{overview.organizationCounts.total}</p><p className="text-xs text-muted-foreground">{overview.organizationCounts.active} activas · {overview.organizationCounts.suspended} suspendidas</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="size-4" /> Usuarios activos</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{overview.activeUsers}</p><p className="text-xs text-muted-foreground">Membresías activas</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-4" /> MRR contratado</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{totals(overview.mrrByCurrency)}</p><p className="text-xs text-muted-foreground">Separado por moneda</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><CircleDollarSign className="size-4" /> Cobrado este mes</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold">{totals(overview.cashThisMonthByCurrency)}</p><p className="text-xs text-muted-foreground">Cargos PAID, sin conversión FX</p></CardContent></Card>
      </section>
      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card><CardHeader><CardTitle>Tendencia mensual</CardTitle></CardHeader><CardContent><div className="grid gap-2 text-sm">{overview.monthlyTrend.map((month) => <div key={month.month} className="grid grid-cols-[100px_1fr_1fr] gap-3 border-b py-2 last:border-0"><span className="font-medium">{month.month}</span><span>MRR: {totals(month.mrrByCurrency)}</span><span>Cobrado: {totals(month.cashByCurrency)}</span></div>)}</div></CardContent></Card>
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>Nueva organización</CardTitle></CardHeader><CardContent><form action={createOrganizationAction} className="space-y-2"><Input name="name" placeholder="Nombre" required /><Input name="slug" placeholder="slug-kebab-case" required /><div className="grid grid-cols-2 gap-2"><Input name="timeZone" defaultValue="Etc/GMT+6" /><Input name="defaultCurrency" defaultValue="MXN" maxLength={3} /></div><SubmitButton>Crear organización</SubmitButton></form><p className="mt-2 text-xs text-muted-foreground">Bloqueado mientras exista la barrera singleton.</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Nuevo plan</CardTitle></CardHeader><CardContent><form action={createPlanAction} className="space-y-2"><div className="grid grid-cols-2 gap-2"><Input name="code" placeholder="PRO" required /><Input name="name" placeholder="Nombre" required /></div><div className="grid grid-cols-2 gap-2"><Input name="monthlyAmountMinor" type="number" min={0} placeholder="Importe menor" required /><Input name="currency" defaultValue="MXN" maxLength={3} /></div><SubmitButton>Crear plan</SubmitButton></form></CardContent></Card>
        </div>
      </section>
      <Card><CardHeader><CardTitle>Organizaciones</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Organización</TableHead><TableHead>Estado</TableHead><TableHead>Plan</TableHead><TableHead>Usuarios</TableHead><TableHead>MRR</TableHead><TableHead>Cobrado</TableHead><TableHead>Último acceso</TableHead></TableRow></TableHeader><TableBody>{overview.organizations.map((organization) => <TableRow key={organization.id}><TableCell><Link className="font-medium text-primary hover:underline" href={`/platform/organizations/${organization.id}`}>{organization.name}</Link><div className="text-xs text-muted-foreground">{organization.slug}</div></TableCell><TableCell>{organization.status}</TableCell><TableCell>{organization.plan}</TableCell><TableCell>{organization.activeUsers}/{organization.users}</TableCell><TableCell>{totals(organization.mrrByCurrency)}</TableCell><TableCell>{totals(organization.cashByCurrency)}</TableCell><TableCell>{organization.lastAccessAt ? new Date(organization.lastAccessAt).toLocaleDateString("es-MX") : "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    </div>
  );
}
