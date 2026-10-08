"use client";

import { useMemo, useState, useTransition } from "react";
import { Copy, Database, RotateCcw, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { provisionDemoOrganizationAction, resetDemoOrganizationAction, extendDemoTrialAction, suspendOrganizationAction, reactivateOrganizationAction } from "@/app/(platform)/platform/organizations/demo-actions";
import type { DemoOrganizationSummary } from "@/lib/demo-organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(value: string) {
  return ({ ACTIVE: "Activa", PROVISIONING: "Provisionando", RESETTING: "Reiniciando", SUSPENDED: "Suspendida", FAILED: "Falló" } as Record<string, string>)[value] ?? value;
}

function statusVariant(value: string): "default" | "secondary" | "destructive" | "outline" {
  if (value === "ACTIVE") return "default";
  if (value === "SUSPENDED" || value === "FAILED") return "destructive";
  if (value === "PROVISIONING" || value === "RESETTING") return "secondary";
  return "outline";
}

export function DemoOrganizationPanel({ initialOrganizations, enabled }: { initialOrganizations: DemoOrganizationSummary[]; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [credentials, setCredentials] = useState<Array<{ email: string; password: string; name: string }>>([]);
  const [resetReason, setResetReason] = useState("Solicitud de reinicio del prospecto");
  const [days, setDays] = useState("30");

  const organizations = useMemo(() => initialOrganizations, [initialOrganizations]);

  function provision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await provisionDemoOrganizationAction({ requestId: crypto.randomUUID(), name, slug, ownerName, requestedUsers: 1 });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCredentials(result.credentials ?? (result.temporaryPassword ? [{ email: result.ownerEmail, password: result.temporaryPassword, name: ownerName }] : []));
      toast.success("DEMO provisionado y validado.");
      setName("");
      setSlug("");
      setOwnerName("");
      router.refresh();
    });
  }

  function reset(organizationId: string, dryRun: boolean) {
    if (!dryRun && !window.confirm("Reiniciar este DEMO? Se eliminarán los datos cargados y se restaurará la línea base sintética.")) return;
    startTransition(async () => {
      const result = await resetDemoOrganizationAction({ organizationId, requestId: crypto.randomUUID(), reason: resetReason, dryRun });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(dryRun ? "Vista previa generada." : "Reinicio DEMO completado.");
        router.refresh();
      }
    });
  }

  function extend(organizationId: string) {
    if (!window.confirm(`Extender la prueba ${days} días para este DEMO?`)) return;
    startTransition(async () => {
      const result = await extendDemoTrialAction({ organizationId, days: Number(days), reason: "Extensión autorizada por ventas" });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(`Prueba extendida hasta ${formatDate(result.trialEndsAt)}`);
        router.refresh();
      }
    });
  }

  function toggle(organization: DemoOrganizationSummary) {
    const nextAction = organization.status === "ACTIVE" ? "suspender" : "reactivar";
    if (!window.confirm(`${nextAction[0].toUpperCase()}${nextAction.slice(1)} este DEMO?`)) return;
    const action = organization.status === "ACTIVE" ? suspendOrganizationAction : reactivateOrganizationAction;
    startTransition(async () => {
      const result = await action({ organizationId: organization.organizationId, reason: organization.status === "ACTIVE" ? "Pausa solicitada por ventas" : "Reactivación autorizada por ventas" });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(organization.status === "ACTIVE" ? "DEMO suspendido." : "DEMO reactivado.");
        router.refresh();
      }
    });
  }

  async function copyCredentials() {
    if (credentials.length === 0) return;
    await navigator.clipboard.writeText(credentials.map((credential) => `${credential.name}: ${credential.email} / ${credential.password}`).join("\n"));
    toast.success("Credenciales copiadas.");
  }

  return (
    <section className="space-y-5 rounded-xl border border-cyan-200/70 bg-cyan-50/40 p-5 dark:border-cyan-900/60 dark:bg-cyan-950/15" aria-labelledby="demo-console">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Sales-assisted</p><h2 id="demo-console" className="text-xl font-semibold">Organizaciones DEMO</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Cada prospecto recibe un tenant aislado, datos sintéticos deterministas y credenciales temporales. No se crean cuentas públicas.</p></div>
        {!enabled ? <Badge variant="outline" className="w-fit border-amber-300 text-amber-800 dark:text-amber-200">Provisionamiento deshabilitado</Badge> : <Badge variant="outline" className="w-fit border-emerald-300 text-emerald-800 dark:text-emerald-200">Controles habilitados</Badge>}
      </div>

      <form onSubmit={provision} className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="demo-name">Prospecto / organización</Label><Input id="demo-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} disabled={!enabled || pending} /></div>
        <div className="space-y-1"><Label htmlFor="demo-slug">Slug</Label><Input id="demo-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="auto" maxLength={48} disabled={!enabled || pending} /></div>
        <div className="space-y-1"><Label htmlFor="demo-owner">Propietario</Label><Input id="demo-owner" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} required maxLength={160} disabled={!enabled || pending} /></div>
        <div className="sm:col-span-3"><p className="mb-3 text-xs text-muted-foreground">Cada prospecto recibe una organización y una cuenta temporal.</p><Button type="submit" disabled={!enabled || pending}><UserPlus className="mr-2 size-4" />{pending ? "Provisionando…" : "Provisionar DEMO"}</Button></div>
      </form>

      {credentials.length > 0 ? <div className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100"><div><p className="font-semibold">Credenciales temporales — copiar ahora</p><p className="text-xs opacity-80">Solo se muestran una vez. Entrégalas fuera de banda y solicita el cambio en el primer acceso.</p></div><div className="space-y-1">{credentials.map((credential) => <code key={credential.email} className="block rounded bg-background/80 px-3 py-2 font-mono text-xs">{credential.name}: {credential.email} / {credential.password}</code>)}</div><Button type="button" variant="outline" className="w-fit" onClick={() => void copyCredentials()}><Copy className="mr-2 size-4" />Copiar todas</Button></div> : null}

      <div className="space-y-3">
        {organizations.length === 0 ? <p className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">Todavía no hay organizaciones DEMO.</p> : organizations.map((organization) => (
          <article key={organization.organizationId} className="rounded-lg border bg-background p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{organization.name}</h3><Badge variant={statusVariant(organization.status)}>{statusLabel(organization.status)}</Badge>{organization.resetStatus && organization.resetStatus !== "IDLE" ? <Badge variant="outline">Reset: {organization.resetStatus}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{organization.slug} · {organization.organizationId} · seed {organization.seedVersion ?? "—"} · versión {organization.dataVersion ?? "—"}</p></div><div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs text-muted-foreground sm:grid-cols-4"><span><strong className="block text-sm text-foreground">{organization.activeMemberCount}/{organization.userCount}</strong>usuarios</span><span><strong className="block text-sm text-foreground">{organization.clientCount}</strong>clientes</span><span><strong className="block text-sm text-foreground">{organization.policyCount}</strong>pólizas</span><span><strong className="block text-sm text-foreground">{formatDate(organization.trialEndsAt)}</strong>fin de prueba</span></div></div>
            <div className="mt-4 grid gap-3 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4"><span>Primer reset por datos reales: <strong className="text-foreground">{formatDate(organization.realDataResetAt)}</strong></span><span>Último reset: <strong className="text-foreground">{formatDate(organization.lastResetAt)}</strong></span><span>Última actividad: <strong className="text-foreground">{formatDate(organization.lastActivityAt)}</strong></span><span>Capacidades: <strong className="text-foreground">{organization.capabilities.filter((capability) => capability.enabled).map((capability) => capability.key).join(", ") || "ninguna"}</strong></span></div>
            {organization.resetFailure ? <p className="mt-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/20 dark:text-red-100"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span><strong className="font-semibold">Verificación fallida:</strong> {organization.resetFailure}<br /><span className="opacity-80">Mantén el DEMO suspendido, revisa los logs y ejecuta una vista previa antes de reintentar. No se expone la línea base hasta que la verificación termine.</span></span></p> : null}
            <div className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-52 space-y-1"><Label htmlFor={`demo-reset-reason-${organization.organizationId}`} className="text-xs">Motivo de reset</Label><Input id={`demo-reset-reason-${organization.organizationId}`} value={resetReason} onChange={(event) => setResetReason(event.target.value)} maxLength={500} disabled={pending} /></div><div className="w-24 space-y-1"><Label htmlFor={`demo-extension-days-${organization.organizationId}`} className="text-xs">Días</Label><Input id={`demo-extension-days-${organization.organizationId}`} type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} disabled={pending} /></div><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => reset(organization.organizationId, true)}><Database className="mr-2 size-4" />Vista previa</Button><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => reset(organization.organizationId, false)}><RotateCcw className="mr-2 size-4" />Reiniciar DEMO</Button><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => extend(organization.organizationId)}>Extender</Button><Button type="button" variant={organization.status === "ACTIVE" ? "destructive" : "outline"} size="sm" disabled={pending || (organization.resetStatus === "FAILED" && organization.status !== "ACTIVE")} onClick={() => toggle(organization)}>{organization.status === "ACTIVE" ? "Suspender" : "Reactivar"}</Button></div>
          </article>
        ))}
      </div>
    </section>
  );
}
