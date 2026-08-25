import Link from "next/link";
import { Activity, ArrowRight, Building2, CreditCard, Database, ShieldCheck } from "lucide-react";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { getPlatformOverview } from "@/lib/platform-dashboard";
import { getPlatformBackupHealth } from "@/lib/backup-catalog";

export const dynamic = "force-dynamic";

const modules = [
  { href: "/platform/organizations", label: "Organizaciones", description: "Salud, memberships, actividad y provisionamiento.", icon: Building2 },
  { href: "/platform/billing", label: "Facturación", description: "MRR, cargos, suscripciones y catálogo de planes.", icon: CreditCard },
  { href: "/platform/backups", label: "Respaldos", description: "Estado, verificación y catálogo de snapshots globales.", icon: Database },
  { href: "/platform/integrations", label: "Integraciones", description: "Controles globales de Telegram y servicios de plataforma.", icon: Activity },
];

export default async function PlatformPage({ searchParams }: { searchParams?: Promise<{ q?: string; status?: string; page?: string; forcePassword?: string }> }) {
  const platformAdmin = await requireSuperAdminOrRedirect();
  const params = (await searchParams) ?? {};
  if (params.q || params.status || params.page) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.status) query.set("status", params.status);
    if (params.page) query.set("page", params.page);
    const { redirect } = await import("next/navigation");
    redirect(`/platform/organizations${query.toString() ? `?${query.toString()}` : ""}`);
  }
  const [overview, backupHealth] = await Promise.all([getPlatformOverview({}), getPlatformBackupHealth()]);
  const forcePassword = platformAdmin.mustChangePassword || params.forcePassword === "1";
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
      <header className="flex flex-col gap-5 rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-slate-50 p-6 dark:border-cyan-950 dark:from-cyan-950/40 dark:via-slate-950 dark:to-slate-950 sm:flex-row sm:items-start sm:justify-between sm:p-8">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">Centro de control</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Resumen de plataforma</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Supervisión global de organizaciones, memberships, salud y actividad. Esta sesión no abre datos operativos tenant.</p></div>
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-600 text-white shadow-lg shadow-cyan-900/15"><ShieldCheck className="size-6" aria-hidden /></div>
      </header>

      {forcePassword ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" aria-labelledby="forced-password-change"><h2 id="forced-password-change" className="text-lg font-semibold">Actualiza tu contraseña para continuar</h2><p className="mt-1 text-sm">La contraseña temporal es de un solo uso.</p><Link href="/platform/account" className="mt-3 inline-flex text-sm font-medium underline">Ir a Mi cuenta <ArrowRight className="ml-1 size-4" /></Link></section> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de plataforma">
        <Metric label="Organizaciones" value={overview.summary.organizations} />
        <Metric label="Activas" value={overview.summary.activeOrganizations} />
        <Metric label="Suspendidas" value={overview.summary.suspendedOrganizations} />
        <Metric label="Usuarios activos" value={overview.summary.activeUsers} />
        <Metric label="Memberships" value={overview.summary.activeMemberships} />
        <Metric label="Owners activos" value={overview.summary.activeOwners} />
        <Metric label="Admins master" value={overview.summary.activePlatformAdmins} />
      </section>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="platform-backup-health">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="platform-backup-health" className="font-semibold">Salud de backups globales</h2>
            <p className="mt-1 text-sm text-muted-foreground">Supervisión del último snapshot verificado y de la ventana semanal.</p>
          </div>
          <Link href="/platform/backups" className="inline-flex items-center text-sm font-medium text-primary underline">Administrar backups <ArrowRight className="ml-1 size-4" aria-hidden /></Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Último verificado" value={backupHealth.latestVerified ? new Date(backupHealth.latestVerified.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Ninguno"} />
          <Metric label="Próximo vencimiento" value={new Date(backupHealth.nextDueAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })} />
          <Metric label="Estado semanal" value={backupHealth.status} />
          <Metric label="CREATING / BLOCKED" value={`${backupHealth.creating} / ${backupHealth.blocked}`} />
        </div>
      </section>

      <section aria-labelledby="platform-modules"><div className="mb-3"><h2 id="platform-modules" className="text-lg font-semibold">Módulos de plataforma</h2><p className="mt-1 text-sm text-muted-foreground">Cada capacidad tiene ahora su propio espacio de trabajo.</p></div><div className="grid gap-4 md:grid-cols-2">{modules.map(({ href, label, description, icon: Icon }) => <Link key={href} href={href} className="group rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"><div className="flex items-start justify-between gap-4"><span className="grid size-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300"><Icon className="size-5" aria-hidden /></span><ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-cyan-600" aria-hidden /></div><h3 className="mt-5 font-semibold">{label}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></Link>)}</div></section>

      <p className="text-sm text-muted-foreground">Sesión master: {platformAdmin.email}. Las operaciones tenant requieren una membership explícita y se realizan desde el CRM de la organización.</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>;
}
