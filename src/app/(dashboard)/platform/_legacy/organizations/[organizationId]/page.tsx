import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { Pagination } from "@/components/lists/pagination";
import { getOrganizationOptions } from "@/lib/organization-context";
import { getPlatformOrganizationDetail } from "@/lib/platform-dashboard";
import { getPlatformBillingDetail } from "@/lib/platform-billing";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getBackupPreflightStatus } from "@/lib/backup";
import { OrganizationBackupsPanel } from "@/components/platform/organization-backups-panel";
import {
  createOrganizationBackup,
  listOrganizationBackupsAction,
} from "@/app/(dashboard)/settings/backups-actions";
import { PlatformPasswordReset } from "@/components/platform/platform-password-reset";
import { PlatformOrganizationBillingPanel } from "@/components/platform/platform-billing-panel";

export const dynamic = "force-dynamic";

function formatDateTime(value: Date | null) {
  if (!value) return "Sin login registrado";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function statusLabel(value: string) {
  if (value === "ACTIVE") return "Activa";
  if (value === "SUSPENDED") return "Suspendida";
  if (value === "BOOTSTRAP") return "Bootstrap";
  if (value === "RESTORING") return "Restaurando";
  return value;
}

function healthLabel(value: string) {
  if (value === "NO_ACTIVE_OWNER") return "Sin Owner activo";
  if (value === "NO_ACTIVE_MEMBERS") return "Sin miembros activos";
  if (value === "INACTIVE_WITH_ACTIVE_MEMBERS") return "Inactiva con miembros";
  return value;
}

export default async function PlatformOrganizationPage({ params, searchParams }: { params: Promise<{ organizationId: string }>; searchParams?: Promise<{ members?: string; memberPage?: string }> }) {
  await requireSuperAdminOrRedirect();
  const { organizationId } = await params;
  const query = (await searchParams) ?? {};
  let decodedOrganizationId: string;
  try {
    decodedOrganizationId = decodeURIComponent(organizationId);
  } catch {
    notFound();
  }
  const [detail, billing] = await Promise.all([
    getPlatformOrganizationDetail(decodedOrganizationId, { memberQuery: query.members, memberPage: query.memberPage }),
    getPlatformBillingDetail(decodedOrganizationId),
  ]);
  if (!detail || !billing) notFound();
  const [options, initialBackups] = await Promise.all([
    getOrganizationOptions(),
    listOrganizationBackupsAction(detail.organization.id).catch(() => []),
  ]);
  const canSelectThisOrganization = options.some((option) => option.id === detail.organization.id);
  const memberPaginationParams = { members: query.members };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3"><Link prefetch={false} href="/platform" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline"><ArrowLeft className="size-4" aria-hidden />Volver a organizaciones</Link>{canSelectThisOrganization ? <Link prefetch={false} href="/organization/select" className="inline-flex items-center gap-2 text-sm font-medium text-primary underline">Seleccionar organización <ExternalLink className="size-4" aria-hidden /></Link> : null}</div>
      <header className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-muted-foreground">Organización · {detail.organization.kind}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{detail.organization.name}</h1><p className="mt-2 text-sm text-muted-foreground">{detail.organization.slug} · {statusLabel(detail.organization.status)} · {detail.organization.timeZone} · {detail.organization.defaultCurrency}</p></div><ShieldCheck className="size-7 text-primary" aria-hidden /></header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resumen de organización">
        <Metric label="Miembros" value={detail.organization.activeMemberCount} />
        <Metric label="Owners" value={detail.organization.activeOwnerCount} />
        <Metric label="Clientes" value={detail.organization.clientCount} />
        <Metric label="Pólizas" value={detail.organization.policyCount} />
        <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Último login de un miembro</p><p className="mt-1 text-sm font-semibold">{formatDateTime(detail.organization.lastMemberLoginAt)}</p></div>
      </section>
      <OrganizationBackupsPanel
        organizationId={detail.organization.id}
        initialBackups={initialBackups}
        backupStatus={getBackupPreflightStatus()}
        createBackup={createOrganizationBackup}
        listBackups={listOrganizationBackupsAction}
      />
      {detail.organization.health.length > 0 ? <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">Revisión requerida: {detail.organization.health.map(healthLabel).join(" · ")}</p> : <p className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">La organización tiene Owner y miembros activos.</p>}

      <PlatformOrganizationBillingPanel organizationId={detail.organization.id} detail={billing} />

      <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="platform-memberships"><div className="border-b p-4"><h2 id="platform-memberships" className="font-semibold">Memberships</h2><form className="mt-3 flex gap-2" method="get"><input name="members" defaultValue={query.members ?? ""} placeholder="Buscar usuario o email" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><button type="submit" className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Buscar</button></form></div>{detail.memberships.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No hay memberships que coincidan.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Membership</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Último login</th><th className="px-4 py-3 text-right">Credenciales</th></tr></thead><tbody className="divide-y">{detail.memberships.map((membership) => <tr key={membership.id}><td className="px-4 py-3"><p className="font-medium">{membership.userName}</p><p className="text-xs text-muted-foreground">{membership.userEmail}</p></td><td className="px-4 py-3">{membership.role}</td><td className="px-4 py-3">{membership.active && membership.userActive ? "Activa" : "Inactiva"}</td><td className="px-4 py-3 text-muted-foreground">{formatDateTime(membership.lastLoginAt)}</td><td className="px-4 py-3 text-right"><PlatformPasswordReset userId={membership.userId} name={membership.userName} email={membership.userEmail} /></td></tr>)}</tbody></table></div>}<Pagination page={Number(query.memberPage ?? "1") || 1} pageSize={25} total={detail.membershipTotal} basePath={`/platform/organizations/${encodeURIComponent(detail.organization.id)}`} searchParams={memberPaginationParams} /></section>

      <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="platform-activity"><div className="border-b p-4"><h2 id="platform-activity" className="font-semibold">Actividad reciente</h2><p className="mt-1 text-sm text-muted-foreground">Solo eventos atribuidos a esta organización. Los valores antiguos y nuevos no se muestran.</p></div>{detail.activities.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No hay actividad registrada.</p> : <div className="divide-y">{detail.activities.map((activity) => <div key={activity.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{activity.action}</p><p className="text-xs text-muted-foreground">{activity.entityType} · {activity.entityId} · {activity.actorName}{activity.actorEmail ? ` · ${activity.actorEmail}` : ""}</p></div><time className="text-xs text-muted-foreground" dateTime={activity.createdAt.toISOString()}>{formatDateTime(activity.createdAt)}</time></div>)}</div>}</section>
      <p className="text-sm text-muted-foreground">Este detalle es de consulta. Las operaciones requieren contexto tenant explícito y permisos dentro de la organización.</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
