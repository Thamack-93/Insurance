import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Plus, ShieldCheck } from "@/components/icons";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/lists/pagination";
import { businessAddDays, businessStartOfDay, businessToday, formatBusinessDateInput, formatBusinessDateRelative } from "@/lib/business-dates";
import { formatDate } from "@/lib/dates";
import { policyTypeLabel } from "@/lib/status";
import { claimOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import { getPolicyObjectDescription, policyObjectSearchTerms } from "@/lib/policy-identity";
import { PolicyIdentity } from "@/components/policies/policy-identity";
import { getWorkItems, getWorkItemsPage, OPEN_WORK_ITEM_STATUSES, type WorkQueueItem } from "@/lib/work-queue";
import { buildOperationalWorkItemPresentation, type OperationalRenewalState } from "@/lib/operations-presentation";
import { readAllowedTableParam, readTablePage, readTableParam } from "@/lib/table-query";
import { cn } from "@/lib/utils";
import { getWorkItemHref } from "@/lib/work-item-navigation";
import { RenewalBoard } from "@/components/renewals/renewal-board";
import { RenewalBoardFilters } from "@/components/renewals/renewal-board-filters";
import { getRenewalBoardOwners, loadRenewalBoard } from "@/lib/renewal-board";
import { readRenewalBoardFilters, renewalManualFollowUpWorkItemSourceId, renewalWindowRange, UNASSIGNED_OWNER_VALUE } from "@/lib/renewal-board.logic";
import { Badge } from "@/components/ui/badge";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { PRIORITIES, WORK_ITEM_TYPES } from "@/lib/domain-values";
import { workItemTypeLabel } from "@/lib/ui-labels";
import { appendReturnTo } from "@/lib/return-to";
import { buildCanonicalHref } from "@/lib/navigation-redirects";
import { withTenantTransaction } from "@/lib/organization-context";
import { SavedQueueControls } from "@/components/queues/saved-queue-controls";
import { RenewalFollowUpMenu } from "@/components/renewals/renewal-follow-up-menu";

type OperationsView = "all" | "pending" | "renewals" | "claims";

const localItems = [
  { label: "Todo", href: "/operations", excludeQueryKeys: ["view"] },
  { label: "Pendientes", href: "/operations?view=pending" },
  { label: "Renovaciones", href: "/operations?view=renewals", activeHrefs: ["/operations?view=renewal-board"] },
  { label: "Siniestros", href: "/operations?view=claims" },
];

const RENEWAL_PAGE_SIZE = 25;
const WORK_ITEM_PAGE_SIZE = 50;
const RENEWAL_SAVED_QUEUE_ROUTES = ["renewal-board", "operations"] as const;

function readView(value?: string): OperationsView {
  if (value === "renewal-board") return "renewals";
  return value === "pending" || value === "renewals" || value === "claims" ? value : "all";
}

const operationalStateClasses: Record<OperationalRenewalState, string> = {
  VENCIDA: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  URGENTE: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  PROXIMA: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  PENDIENTE: "border-border bg-muted text-muted-foreground",
};

const operationalStateLabels: Record<OperationalRenewalState, string> = {
  VENCIDA: "Vencida",
  URGENTE: "Urgente",
  PROXIMA: "Próxima",
  PENDIENTE: "Pendiente",
};

function WorkItemRow({ item, returnTo }: { item: WorkQueueItem; returnTo?: string }) {
  const href = appendReturnTo(getWorkItemHref(item), returnTo);
  const clientLabel = item.client?.fullName ?? "Sin cliente asociado";
  const policyType = item.policy ? policyTypeLabel(item.policy.policyType) : "Tipo no disponible";
  const insurerLabel = item.insurer?.name ?? "Sin aseguradora asociada";
  const presentation = buildOperationalWorkItemPresentation({
    sourceType: item.sourceType,
    taskType: item.taskType,
    title: item.title,
    description: item.description,
    dueDate: item.dueDate,
    policy: item.policy,
  });
  const policyNumber = item.policy?.policyNumber;
  const title = presentation.isRenewal
    ? `${presentation.state === "VENCIDA" ? "Renovación vencida" : "Renovación"}${policyNumber ? ` · ${policyNumber}` : ""}`
    : item.title;
  const renewalDateLabel = presentation.renewalLabel && item.policy?.endDate
    ? `${presentation.renewalLabel}: ${formatDate(item.policy.endDate)}`
    : null;
  const followUpLabel = presentation.followUpPending
    ? "Seguimiento pendiente"
    : item.dueDate
    ? `${presentation.followUpOverdue ? "Seguimiento vencido" : "Seguimiento"}: ${formatDate(item.dueDate)} · ${formatBusinessDateRelative(item.dueDate)}`
    : "Seguimiento pendiente";
  const actionLabel = item.policy && presentation.isRenewal ? "Abrir póliza" : "Abrir pendiente";
  const stateLabel = presentation.state ? operationalStateLabels[presentation.state] : null;
  const isManualRenewalFollowUp = Boolean(
    item.policyId && item.sourceType === "Renewal" && item.sourceId === renewalManualFollowUpWorkItemSourceId(item.policyId),
  );
  const canEditFromOperations = !isManualRenewalFollowUp && (item.sourceType === "WorkItem" || item.sourceType === "Task" || item.sourceType === null);
  return (
    <li className="border-b px-4 py-3 last:border-b-0">
      <div className="grid gap-2">
        <Link
          href={href}
          aria-label={`${actionLabel}: ${title}`}
          className="block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{title}</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">Cliente: {clientLabel} · {policyType} · Aseguradora: {insurerLabel}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {renewalDateLabel ? `${renewalDateLabel} · ` : ""}
              {followUpLabel}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
              {actionLabel}
              <ArrowRight className="size-3.5" aria-hidden />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {stateLabel && presentation.state ? (
              <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[11px] ${operationalStateClasses[presentation.state]}`}>
                {stateLabel}
              </Badge>
            ) : null}
            <PriorityBadge priority={item.priority} className="px-2 py-0.5 text-[11px]" />
          </div>
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isManualRenewalFollowUp && item.policy ? (
            <RenewalFollowUpMenu
              policyId={item.policyId ?? ""}
              policyNumber={item.policy.policyNumber}
              currentDueDate={item.dueDate ? formatBusinessDateInput(item.dueDate) : null}
              currentNotes={item.notes}
            />
          ) : canEditFromOperations ? (
            <Link
              href={appendReturnTo(`/tasks/${item.sourceId ?? item.id}/edit`, returnTo)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-9 px-2 text-xs")}
              aria-label={`Editar pendiente: ${title}`}
            >
              Editar
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function WorkItemColumn({ title, count, items, tone, viewAllHref, returnTo }: { title: string; count: number; items: WorkQueueItem[]; tone: string; viewAllHref?: string; returnTo?: string }) {
  return (
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center justify-between gap-3">
          <span className={tone}>{title}</span>
          <span className="flex flex-col items-end gap-1">
            <span className="font-mono text-base">{count}</span>
            {viewAllHref ? <Link href={viewAllHref} className="text-xs font-medium text-primary hover:underline">Ver las {count} pendientes</Link> : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {items.length ? <ul>{items.map((item) => <WorkItemRow key={item.id} item={item} returnTo={returnTo} />)}</ul> : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nada pendiente en este grupo.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OperationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const view = readView(typeof params.view === "string" ? params.view : undefined);
  const page = readTablePage(params);
  const renewalMode = readAllowedTableParam(params, "mode", ["board", "list"] as const) ?? "board";
  const query = view === "pending" || view === "renewals" || view === "claims" ? readTableParam(params, "q")?.trim() : undefined;
  const priority = view === "pending" ? readAllowedTableParam(params, "priority", PRIORITIES) : undefined;
  const workItemType = view === "pending" ? readAllowedTableParam(params, "workItemType", WORK_ITEM_TYPES) : undefined;
  const boardFilters = readRenewalBoardFilters(params);
  const renewalRange = renewalWindowRange(boardFilters.window);
  const scope = await requireOrganizationPortfolioReadScope();
  const organizationKind = view === "renewals" && renewalMode === "board"
    ? await withTenantTransaction(scope.context, (tx) => tx.organization.findUnique({ where: { id: scope.organizationId }, select: { kind: true } }))
    : null;
  const today = businessToday();
  const nextSeven = businessAddDays(today, 7);
  const [board, boardOwners] =
    view === "renewals"
      ? await Promise.all([
          renewalMode === "board" ? loadRenewalBoard(boardFilters, scope.portfolioOwnerId, scope.organizationId) : Promise.resolve(null),
          getRenewalBoardOwners(scope.portfolioOwnerId, scope.organizationId),
        ])
      : [null, []];

  const claimWhere: Prisma.ClaimWhereInput = {
    AND: [
      claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
      { status: { notIn: ["RESOLVED", "CANCELLED"] } },
      ...(query && view === "claims" ? [{
        OR: [
          { folio: { contains: query } },
          { claimType: { contains: query } },
          { client: { fullName: { contains: query } } },
          { policy: { policyNumber: { contains: query } } },
          { insurer: { name: { contains: query } } },
        ],
      }] : []),
    ],
  };
  const renewalListConditions: Prisma.PolicyWhereInput[] = [];
  if (!scope.portfolioOwnerId && boardFilters.owner) {
    renewalListConditions.push({
      client: {
        portfolioOwnerId: boardFilters.owner === UNASSIGNED_OWNER_VALUE ? null : boardFilters.owner,
      },
    });
  }
  if (query && view === "renewals") {
    renewalListConditions.push({
      OR: [
        { policyNumber: { contains: query } },
        { client: { fullName: { contains: query } } },
        { insurer: { name: { contains: query } } },
        ...policyObjectSearchTerms(query),
      ],
    });
  }
  const renewalListWhere: Prisma.PolicyWhereInput = view === "all"
    ? { endDate: { lte: businessAddDays(today, 30) } }
    : {
        endDate: {
          ...(renewalRange.from ? { gte: renewalRange.from } : {}),
          ...(renewalRange.to ? { lte: renewalRange.to } : {}),
        },
        ...(renewalListConditions.length ? { AND: renewalListConditions } : {}),
      };
  const [workItems, workItemsPage, renewalPolicies, claimData] = await Promise.all([
    view === "all" ? getWorkItems({
      organizationId: scope.organizationId,
      statuses: OPEN_WORK_ITEM_STATUSES,
      portfolioOwnerId: scope.portfolioOwnerId,
      limit: 100,
    }) : Promise.resolve([]),
    view === "pending" ? getWorkItemsPage({
      organizationId: scope.organizationId,
      statuses: OPEN_WORK_ITEM_STATUSES,
      portfolioOwnerId: scope.portfolioOwnerId,
      query,
      priorities: priority ? [priority] : undefined,
      workItemTypes: workItemType ? [workItemType] : undefined,
      limit: WORK_ITEM_PAGE_SIZE,
      skip: (page - 1) * WORK_ITEM_PAGE_SIZE,
    }) : Promise.resolve(null),
    view === "all" || (view === "renewals" && renewalMode === "list")
      ? loadEligibleRenewalPolicies(renewalListWhere, scope.portfolioOwnerId, scope.organizationId, undefined, true)
      : Promise.resolve([]),
    withTenantTransaction(scope.context, async (db) => ({
      claims: await db.claim.findMany({
        where: claimWhere,
        select: { id: true, folio: true, claimType: true, status: true, incidentDate: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true } } },
        orderBy: [{ reportedDate: "desc" }, { id: "asc" }],
        take: view === "claims" ? 25 : 50,
        skip: view === "claims" ? (page - 1) * 25 : 0,
      }),
      claimTotal: await db.claim.count({ where: claimWhere }),
    })),
  ]);
  const visibleWorkItems = workItemsPage?.items ?? workItems;
  const workItemsTotal = workItemsPage?.totalCount ?? workItems.length;
  const { claims, claimTotal } = claimData;
  const checklistCounts = view === "claims" && claims.length > 0
    ? await withTenantTransaction(scope.context, async (db) => db.claimChecklistItem.groupBy({
        by: ["claimId", "status"],
        where: { organizationId: scope.organizationId, claimId: { in: claims.map((claim) => claim.id) } },
        _count: { _all: true },
      }))
    : [];
  const pendingByClaim = new Map<string, number>();
  const totalByClaim = new Map<string, number>();
  for (const row of checklistCounts) {
    totalByClaim.set(row.claimId, (totalByClaim.get(row.claimId) ?? 0) + row._count._all);
    if (row.status === "MISSING" || row.status === "REQUESTED") pendingByClaim.set(row.claimId, (pendingByClaim.get(row.claimId) ?? 0) + row._count._all);
  }

  const overdue = visibleWorkItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate) < today);
  const dueToday = visibleWorkItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate).getTime() === today.getTime());
  const upcoming = visibleWorkItems.filter((item) => item.dueDate && businessStartOfDay(item.dueDate) > today && businessStartOfDay(item.dueDate) <= nextSeven);
  const unscheduled = visibleWorkItems.filter((item) => !item.dueDate || businessStartOfDay(item.dueDate) > nextSeven);
  const renewalCount = renewalPolicies.length;
  const renewals = renewalPolicies.slice(
    view === "renewals" ? (page - 1) * RENEWAL_PAGE_SIZE : 0,
    view === "renewals" ? page * RENEWAL_PAGE_SIZE : 8,
  );
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
      description: "Sigue cada renovación por etapa y cambia a la lista cuando necesites revisar el inventario.",
    },
    claims: {
      title: "Siniestros",
      description: "Casos abiertos que requieren seguimiento operativo.",
    },
  }[view];
  const pendingFilterOptions = [
    { value: "TASK", label: workItemTypeLabel("TASK") },
    { value: "NOTIFICATION", label: workItemTypeLabel("NOTIFICATION") },
  ];
  const renewalSearchParams = {
    view: "renewals",
    mode: "list",
    q: query,
    window: boardFilters.window,
    owner: boardFilters.owner,
  };
  const renewalViewHref = (mode: "board" | "list") => buildCanonicalHref(
    "/operations",
    { ...params, page: undefined },
    { view: "renewals", mode },
  );
  const claimSearchParams = { view: "claims", q: query };
  const pendingSearchParams = { view: "pending", q: query, priority, workItemType };
  const returnTo = buildCanonicalHref("/operations", params);

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
              <Link href={renewalViewHref(renewalMode === "board" ? "list" : "board")} className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>
                {renewalMode === "board" ? "Ver como lista" : "Ver como tablero"}
              </Link>
            ) : null}
            <Link href="/tasks/new" className={cn(buttonVariants(), "min-h-11")}>
              <Plus className="size-4" />Crear pendiente
            </Link>
          </>
        }
      />
      <LocalNavigation items={localItems} label="Vistas de operación" />
      <SavedQueueControls
        route={view === "renewals" ? "renewal-board" : "operations"}
        loadRoutes={view === "renewals" ? RENEWAL_SAVED_QUEUE_ROUTES : undefined}
        config={{
          route: view === "renewals" ? "renewal-board" : "operations",
          search: query ?? "",
          filters: view === "renewals"
            ? { view: "renewal-board", mode: renewalMode, window: boardFilters.window, owner: boardFilters.owner ?? "" }
            : { view, priority: priority ?? "", workItemType: workItemType ?? "" },
          version: 1,
        }}
      />

      {view === "all" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumen operativo">
            {[
              { label: "Pendientes abiertos", value: workItems.length, href: "/operations?view=pending", icon: ClipboardList },
              { label: "Renovaciones pendientes", value: renewalCount, href: "/operations?view=renewals", icon: ShieldCheck },
              { label: "Siniestros abiertos", value: claims.length, href: "/operations?view=claims", icon: AlertTriangle },
            ].map(({ label, value, href, icon: Icon }) => (
              <Link key={label} href={href} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="size-4" /></span>
                <strong className="mt-3 block font-mono text-2xl">{value}</strong>
              </Link>
            ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <WorkItemColumn title="Requieren atención" count={overdue.length + dueToday.length} items={[...overdue, ...dueToday].slice(0, 8)} tone="text-destructive" viewAllHref="/operations?view=pending" returnTo={returnTo} />
            <Card size="sm" className="gap-0 py-0">
              <CardHeader className="border-b py-3"><CardTitle className="flex items-center justify-between gap-3"><span>Renovaciones pendientes</span><Link href="/operations?view=renewals" className="text-xs font-medium text-primary hover:underline">Ver las {renewalCount}</Link></CardTitle></CardHeader>
              <CardContent className="px-0">
                {renewals.slice(0, 8).map((policy) => (
                  <div key={policy.id} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
                    <Link href={appendReturnTo(`/policies/${policy.id}`, returnTo)} className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="truncate text-sm font-medium">{policy.client.fullName}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{policy.policyNumber} · {policy.insurer.name}</p>
                      <p className="truncate text-xs text-muted-foreground" title={getPolicyObjectDescription(policy)}>{getPolicyObjectDescription(policy)}</p>
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
        <div className="space-y-4">
          <TableToolbar
            searchPlaceholder="Buscar pendiente, cliente, póliza o recibo..."
            filters={[
              { key: "priority", label: "Prioridad", options: PRIORITIES.map((value) => ({ value, label: value === "LOW" ? "Baja" : value === "MEDIUM" ? "Media" : value === "HIGH" ? "Alta" : "Urgente" })) },
              { key: "workItemType", label: "Tipo", options: pendingFilterOptions },
            ]}
            resultCount={workItemsTotal}
            resultNoun={["pendiente", "pendientes"]}
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <WorkItemColumn title="Atrasados" count={overdue.length} items={overdue} tone="text-destructive" returnTo={returnTo} />
            <WorkItemColumn title="Hoy" count={dueToday.length} items={dueToday} tone="text-amber-700 dark:text-amber-300" returnTo={returnTo} />
            <WorkItemColumn title="Próximos 7 días" count={upcoming.length} items={upcoming} tone="text-blue-700 dark:text-blue-300" returnTo={returnTo} />
            <WorkItemColumn title="Por hacer" count={unscheduled.length} items={unscheduled} tone="text-foreground" returnTo={returnTo} />
          </div>
          <Pagination page={page} pageSize={WORK_ITEM_PAGE_SIZE} total={workItemsTotal} basePath="/operations" searchParams={pendingSearchParams} />
        </div>
      ) : null}

      {view === "renewals" && renewalMode === "list" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <RenewalBoardFilters
              filters={boardFilters}
              owners={boardOwners}
              canFilterByOwner={!scope.portfolioOwnerId}
            />
            <p className="text-sm text-muted-foreground" role="status">
              {renewalCount} {renewalCount === 1 ? "renovación" : "renovaciones"} en esta selección
            </p>
          </div>
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4"><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" />Lista de renovaciones</CardTitle></CardHeader>
            <CardContent className="px-0">
              {renewalCount > 0 && renewals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Póliza</TableHead><TableHead>Cliente</TableHead><TableHead>Aseguradora</TableHead><TableHead>Vencimiento</TableHead><TableHead className="text-right">Acción</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewals.map((policy) => (
                      <TableRow key={policy.id}>
                        <TableCell><Link href={appendReturnTo(`/policies/${policy.id}`, returnTo)} className="font-mono hover:underline"><PolicyIdentity policyNumber={policy.policyNumber} policy={policy} /></Link></TableCell>
                        <TableCell>{policy.client.fullName}</TableCell>
                        <TableCell>{policy.insurer.name}</TableCell>
                        <TableCell><span className="font-mono text-xs">{formatDate(policy.endDate)}</span><span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{formatBusinessDateRelative(policy.endDate)}</span></TableCell>
                        <TableCell className="text-right"><Link href={appendReturnTo(`/policies/new?renewalFrom=${policy.id}`, returnTo)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10")}>Renovar</Link></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : <p className="p-8 text-center text-sm text-muted-foreground">{renewalCount ? "No hay pólizas en esta página." : "No hay renovaciones pendientes."}</p>}
              {renewalCount ? (
                <Pagination
                  page={page}
                  pageSize={RENEWAL_PAGE_SIZE}
                  total={renewalCount}
                  basePath="/operations"
                  searchParams={renewalSearchParams}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === "renewals" && renewalMode === "board" && board?.error ? (
        <section role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-5 text-sm text-destructive">
          <p className="font-semibold">No pudimos cargar el tablero de renovaciones.</p>
          <p className="mt-1">La información no está disponible temporalmente. Intenta actualizar la vista.</p>
          <Link href={buildCanonicalHref("/operations", params)} className="mt-3 inline-flex font-medium underline underline-offset-4">Reintentar</Link>
        </section>
      ) : null}

      {view === "renewals" && renewalMode === "board" && board && !board.error ? (
        <RenewalBoard
          board={board}
          filters={boardFilters}
          owners={boardOwners}
          canFilterByOwner={!scope.portfolioOwnerId}
          isDemo={organizationKind?.kind === "DEMO"}
        />
      ) : null}

      {view === "claims" ? (
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4"><CardTitle>Siniestros abiertos</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="border-b px-4 py-3"><TableToolbar searchPlaceholder="Buscar folio, cliente, póliza o tipo..." tableControls={false} /></div>
            {claims.length ? claims.map((claim) => (
              <div key={claim.id} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-2.5 last:border-b-0">
                <Link href={appendReturnTo(`/claims/${claim.id}`, returnTo)} className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="truncate text-sm font-medium">{claim.client.fullName} · {claim.claimType}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{claim.folio} · {claim.policy.policyNumber} · {formatDate(claim.incidentDate)}</p>
                  <p className="text-xs text-muted-foreground">{totalByClaim.has(claim.id) ? (pendingByClaim.has(claim.id) ? `${pendingByClaim.get(claim.id)} requisitos pendientes` : "Sin requisitos pendientes") : "Sin requisitos"}</p>
                </Link>
                <StatusBadge status={claim.status} entity="claim" className="px-2 py-0.5 text-[11px]" />
              </div>
            )) : <p className="p-8 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-2 size-5 text-emerald-600" />No hay siniestros abiertos.</p>}
            <Pagination page={page} pageSize={25} total={claimTotal} basePath="/operations" searchParams={claimSearchParams} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
