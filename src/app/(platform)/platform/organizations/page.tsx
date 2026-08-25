import Link from "next/link";
import { Building2, ChevronRight, Plus } from "lucide-react";
import { Pagination } from "@/components/lists/pagination";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-dashboard";

export const dynamic = "force-dynamic";

function healthLabel(value: string) {
  if (value === "NO_ACTIVE_OWNER") return "Sin Owner activo";
  if (value === "NO_ACTIVE_MEMBERS") return "Sin miembros activos";
  if (value === "INACTIVE_WITH_ACTIVE_MEMBERS") return "Inactiva con miembros";
  return "Revisar estado";
}

function statusLabel(value: string) {
  if (value === "ACTIVE") return "Activa";
  if (value === "SUSPENDED") return "Suspendida";
  if (value === "BOOTSTRAP") return "Bootstrap";
  if (value === "RESTORING") return "Restaurando";
  return value;
}

function kindLabel(value: string) {
  if (value === "LEGACY") return "Legacy";
  if (value === "DEMO") return "Demo";
  return "Cliente";
}

export default async function PlatformOrganizationsPage({ searchParams }: { searchParams?: Promise<{ q?: string; status?: string; page?: string }> }) {
  await requireSuperAdminOrRedirect();
  const params = (await searchParams) ?? {};
  const overview = await getPlatformOverview({ query: params.q, status: params.status, page: params.page });
  const paginationParams = { q: params.q, status: params.status };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Control de plataforma</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Organizaciones</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Consulta salud, memberships y métricas sin entrar al contexto operativo de ningún tenant.</p></div><Link href="/platform/organizations/new" className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800"><Plus className="size-4" aria-hidden />Nueva organización</Link></header>
      <section className="rounded-xl border bg-card p-4" aria-label="Filtros de organizaciones"><form className="flex flex-col gap-3 sm:flex-row sm:items-end" method="get"><label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">Buscar<input name="q" defaultValue={params.q ?? ""} placeholder="Nombre o slug" className="h-9 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" /></label><label className="flex flex-col gap-1 text-sm font-medium">Estado<select name="status" defaultValue={params.status ?? ""} className="h-9 rounded-lg border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"><option value="">Todos</option><option value="ACTIVE">Activas</option><option value="SUSPENDED">Suspendidas</option><option value="BOOTSTRAP">Bootstrap</option></select></label><button type="submit" className="h-9 rounded-lg bg-cyan-700 px-4 text-sm font-medium text-white hover:bg-cyan-800">Filtrar</button></form></section>
      <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="platform-organizations"><div className="border-b p-4"><h2 id="platform-organizations" className="font-semibold">{overview.total} organizaciones</h2></div>{overview.organizations.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No hay organizaciones que coincidan con los filtros.</p> : <div className="divide-y">{overview.organizations.map((organization) => <Link prefetch={false} key={organization.id} href={`/platform/organizations/${encodeURIComponent(organization.id)}`} className="flex flex-col gap-3 p-4 transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><Building2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0"><p className="truncate font-medium">{organization.name}</p><p className="truncate text-sm text-muted-foreground">{organization.slug} · {organization.timeZone} · {organization.defaultCurrency}</p></div></div><div className="flex flex-wrap items-center gap-3 text-sm"><span className="rounded-full border px-2 py-0.5 text-xs">{kindLabel(organization.kind)}</span><span className="rounded-full border px-2 py-0.5 text-xs">{statusLabel(organization.status)}</span><span>{organization.activeMemberCount} miembros</span><span>{organization.clientCount} clientes</span><span>{organization.policyCount} pólizas</span><span className={organization.health.length > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>{organization.health.length > 0 ? organization.health.map(healthLabel).join(" · ") : "Salud OK"}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden /></div></Link>)}</div>}<Pagination page={overview.page} pageSize={overview.pageSize} total={overview.total} basePath="/platform/organizations" searchParams={paginationParams} /></section>
    </div>
  );
}
