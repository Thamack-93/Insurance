import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Plus, ShieldCheck } from "lucide-react";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { businessAddDays, businessStartOfDay, businessToday, formatBusinessDateRelative } from "@/lib/business-dates";
import { formatDate } from "@/lib/dates";
import { claimOperationalWhere, policyOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES, type WorkQueueItem } from "@/lib/work-queue";
import { cn } from "@/lib/utils";

type OperationsView = "all" | "pending" | "renewals" | "claims";

const localItems = [
  { label: "Todo", href: "/operations", excludeQueryKeys: ["view"] },
  { label: "Pendientes", href: "/operations?view=pending" },
  { label: "Renovaciones", href: "/operations?view=renewals" },
  { label: "Siniestros", href: "/operations?view=claims" },
];

function readView(value?: string): OperationsView {
  return value === "pending" || value === "renewals" || value === "claims" ? value : "all";
}

function WorkItemRow({ item }: { item: WorkQueueItem }) {
  return (
    <li className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
      <Link href={`/tasks/${item.id}`} className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.client?.fullName ?? "Sin cliente"}
          {item.policy?.policyNumber ? ` · ${item.policy.policyNumber}` : ""}
          {item.dueDate ? ` · ${formatBusinessDateRelative(item.dueDate)}` : " · Sin fecha"}
        </p>
      </Link>
      <PriorityBadge priority={item.priority} className="px-2 py-0.5 text-[11px]" />
    </li>
  );
}

function WorkItemColumn({ title, count, items, tone }: { title: string; count: number; items: WorkQueueItem[]; tone: string }) {
  return (
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className={tone}>{title}</span>
          <span className="font-mono text-base">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {items.length ? <ul>{items.map((item) => <WorkItemRow key={item.id} item={item} />)}</ul> : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nada pendiente en este grupo.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OperationsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const params = (await searchParams) ?? {};
  const view = readView(params.view);
  const scope = await requirePortfolioReadScope();
  const db = getDb();
  const today = businessToday();
  const nextSeven = businessAddDays(today, 7);

  const [workItems, renewals, claims] = await Promise.all([
    getWorkItems({ statuses: OPEN_WORK_ITEM_STATUSES, portfolioOwnerId: scope.portfolioOwnerId, limit: 100 }),
    db.policy.findMany({
      where: {
        AND: [
          policyOperationalWhere(scope.portfolioOwnerId),
          { status: "ACTIVE", endDate: { lte: businessAddDays(today, 30) } },
        ],
      },
      select: { id: true, policyNumber: true, endDate: true, client: { select: { fullName: true } }, insurer: { select: { name: true } } },
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: 50,
    }),
    db.claim.findMany({
      where: { AND: [claimOperationalWhere(scope.portfolioOwnerId), { status: { notIn: ["RESOLVED", "CANCELLED"] } }] },
      select: { id: true, folio: true, claimType: true, status: true, incidentDate: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true } } },
      orderBy: [{ reportedDate: "desc" }, { id: "asc" }],
      take: 50,
    }),
  ]);

  const overdue = workItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate) < today);
  const dueToday = workItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate).getTime() === today.getTime());
  const upcoming = workItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate) > today && businessStartOfDay(item.dueDate) <= nextSeven);
  const unscheduled = workItems.filter((item) => !item.dueDate || businessStartOfDay(item.dueDate) > nextSeven);
  const overdueRenewals = renewals.filter((policy) => businessStartOfDay(policy.endDate) < today);
  const upcomingRenewals = renewals.filter((policy) => businessStartOfDay(policy.endDate) >= today);
  const pageCopy = {
    all: {
      title: "Operación",
      description: "Pendientes, renovaciones y siniestros reunidos en una sola cola de trabajo.",
    },
    pending: {
      title: "Pendientes",
      description: "Trabajo abierto organizado por vencimiento y prioridad.",
    },
    renewals: {
      title: "Renovaciones",
      description: "Pólizas vencidas y próximas a vencer listas para seguimiento.",
    },
    claims: {
      title: "Siniestros",
      description: "Casos abiertos que requieren seguimiento operativo.",
    },
  }[view];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Centro operativo"
        title={pageCopy.title}
        description={pageCopy.description}
        actions={
          <>
            {view === "claims" ? (
              <Link href="/claims/new" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>
                Nuevo siniestro
              </Link>
            ) : null}
            {view === "renewals" ? (
              <Link href="/policies/new" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>
                Capturar póliza
              </Link>
            ) : null}
            <Link href="/tasks/new" className={cn(buttonVariants(), "min-h-11")}>
              <Plus className="size-4" />Crear pendiente
            </Link>
          </>
        }
      />
      <LocalNavigation items={localItems} label="Vistas de operación" />

      {view === "all" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumen operativo">
            {[
              { label: "Pendientes abiertos", value: workItems.length, href: "/operations?view=pending", icon: ClipboardList },
              { label: "Renovaciones próximas", value: renewals.length, href: "/operations?view=renewals", icon: ShieldCheck },
              { label: "Siniestros abiertos", value: claims.length, href: "/operations?view=claims", icon: AlertTriangle },
            ].map(({ label, value, href, icon: Icon }) => (
              <Link key={label} href={href} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="size-4" /></span>
                <strong className="mt-3 block font-mono text-2xl">{value}</strong>
              </Link>
            ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <WorkItemColumn title="Requieren atención" count={overdue.length + dueToday.length} items={[...overdue, ...dueToday].slice(0, 8)} tone="text-destructive" />
            <Card size="sm" className="gap-0 py-0">
              <CardHeader className="border-b py-3"><CardTitle>Renovaciones próximas</CardTitle></CardHeader>
              <CardContent className="px-0">
                {renewals.slice(0, 8).map((policy) => (
                  <div key={policy.id} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
                    <Link href={`/policies/${policy.id}`} className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="truncate text-sm font-medium">{policy.client.fullName}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{policy.policyNumber} · {policy.insurer.name}</p>
                    </Link>
                    <span className="text-xs font-medium text-warning-foreground">{formatBusinessDateRelative(policy.endDate)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {view === "pending" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <WorkItemColumn title="Atrasados" count={overdue.length} items={overdue} tone="text-destructive" />
          <WorkItemColumn title="Hoy" count={dueToday.length} items={dueToday} tone="text-amber-700 dark:text-amber-300" />
          <WorkItemColumn title="Próximos 7 días" count={upcoming.length} items={upcoming} tone="text-blue-700 dark:text-blue-300" />
          <WorkItemColumn title="Por hacer" count={unscheduled.length} items={unscheduled} tone="text-foreground" />
        </div>
      ) : null}

      {view === "renewals" ? (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2" aria-label="Resumen de renovaciones">
            <Card size="sm"><CardHeader><CardTitle>Vencidas</CardTitle></CardHeader><CardContent className="font-mono text-2xl font-semibold text-destructive">{overdueRenewals.length}</CardContent></Card>
            <Card size="sm"><CardHeader><CardTitle>Próximos 30 días</CardTitle></CardHeader><CardContent className="font-mono text-2xl font-semibold text-amber-700 dark:text-amber-300">{upcomingRenewals.length}</CardContent></Card>
          </section>
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4"><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" />Renovaciones urgentes</CardTitle></CardHeader>
            <CardContent className="px-0">
              {renewals.length ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Póliza</TableHead><TableHead>Cliente</TableHead><TableHead>Aseguradora</TableHead><TableHead>Vencimiento</TableHead><TableHead className="text-right">Acción</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewals.map((policy) => (
                      <TableRow key={policy.id}>
                        <TableCell><Link href={`/policies/${policy.id}`} className="font-mono font-medium text-primary hover:underline">{policy.policyNumber}</Link></TableCell>
                        <TableCell>{policy.client.fullName}</TableCell>
                        <TableCell>{policy.insurer.name}</TableCell>
                        <TableCell><span className="font-mono text-xs">{formatDate(policy.endDate)}</span><span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{formatBusinessDateRelative(policy.endDate)}</span></TableCell>
                        <TableCell className="text-right"><Link href={`/policies/new?renewalFrom=${policy.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10")}>Renovar</Link></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="p-8 text-center text-sm text-muted-foreground">No hay renovaciones urgentes.</p>}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === "claims" ? (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4"><CardTitle>Siniestros abiertos</CardTitle></CardHeader>
          <CardContent className="px-0">
            {claims.length ? claims.map((claim) => (
              <div key={claim.id} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-2.5 last:border-b-0">
                <Link href={`/claims/${claim.id}`} className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="truncate text-sm font-medium">{claim.client.fullName} · {claim.claimType}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{claim.folio} · {claim.policy.policyNumber} · {formatDate(claim.incidentDate)}</p>
                </Link>
                <StatusBadge status={claim.status} className="px-2 py-0.5 text-[11px]" />
              </div>
            )) : <p className="p-8 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 size-5 text-emerald-600" />No hay siniestros abiertos.</p>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
