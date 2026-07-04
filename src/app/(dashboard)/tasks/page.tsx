import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Flame, ListTodo, MessageSquareWarning, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { WorkItemsTable, type WorkItemRow } from "@/components/tasks/tasks-table";
import { countWorkItems, getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { buildTableHref, readTablePage } from "@/lib/table-query";

const PAGE_SIZE = 25;

export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = readTablePage(params);

  const now = today();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    activeCount,
    urgentCount,
    overdueCount,
    dueSoonCount,
    waitingClientCount,
    filteredCount,
    pagedWorkItems,
    urgentWorkItems,
    overdueWorkItems,
  ] = await Promise.all([
    countWorkItems({ workItemTypes: ["TASK"], statuses: OPEN_WORK_ITEM_STATUSES }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      priorities: ["URGENT"],
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      to: new Date(now.getTime() - 1),
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      from: now,
      to: in7,
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: ["WAITING_CLIENT"],
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      query,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      query,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      priorities: ["URGENT"],
      limit: 10,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      to: new Date(now.getTime() - 1),
      limit: 10,
    }),
  ]);

  const workItemRows: WorkItemRow[] = pagedWorkItems.map((workItem) => ({
    id: workItem.sourceId ?? workItem.id,
    folio: workItem.folio ?? workItem.sourceId ?? workItem.id,
    title: workItem.title,
    workItemType: workItem.taskType ?? "GENERAL",
    priority: workItem.priority,
    status: workItem.status,
    dueDate: workItem.dueDate ? formatDate(workItem.dueDate) : null,
    dueDays: workItem.dueDate ? daysUntil(workItem.dueDate) : null,
    clientId: workItem.clientId,
    clientName: workItem.client?.fullName ?? null,
    policyId: workItem.policyId,
    policyNumber: workItem.policy?.policyNumber ?? null,
  }));

  const urgentWorkItemRows = urgentWorkItems.map((workItem) => ({
    id: workItem.sourceId ?? workItem.id,
    folio: workItem.folio ?? workItem.sourceId ?? workItem.id,
    title: workItem.title,
    priority: workItem.priority,
    status: workItem.status,
    client: workItem.client,
    policy: workItem.policy,
    insurer: workItem.insurer,
    dueDate: workItem.dueDate,
    startDate: workItem.startDate,
  }));

  const overdueWorkItemRows = overdueWorkItems.map((workItem) => ({
    id: workItem.sourceId ?? workItem.id,
    folio: workItem.folio ?? workItem.sourceId ?? workItem.id,
    title: workItem.title,
    priority: workItem.priority,
    status: workItem.status,
    client: workItem.client,
    policy: workItem.policy,
    insurer: workItem.insurer,
    dueDate: workItem.dueDate,
    startDate: workItem.startDate,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Pendientes"
          description="Pendientes vivos, urgentes y bloqueos con cliente o aseguradora."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/tasks/new">
                  <Plus className="mr-2 size-4" />
                  Nuevo pendiente
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/due-payments">
                  Cobranza
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Pendientes activos"
            value={activeCount}
            description="Pendientes que todavía requieren seguimiento."
            icon={CheckCircle2}
            tone="blue"
          />
          <MetricCard
            title="Urgentes"
            value={urgentCount}
            description="Demandan respuesta inmediata."
            icon={Flame}
            tone="rose"
          />
          <MetricCard
            title="Vencidas"
            value={overdueCount}
            description="Pendientes con fecha límite ya superada."
            icon={Clock3}
            tone="amber"
          />
          <MetricCard
            title="Vencen en 7 días"
            value={dueSoonCount}
            description={`${waitingClientCount} casos en espera de documentación o respuesta.`}
            icon={MessageSquareWarning}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          title="Cola principal"
          description="Búsqueda y paginación sobre todos los pendientes activos."
          action={<TableToolbar searchPlaceholder="Buscar por folio, título, cliente o póliza..." />}
        >
          {filteredCount === 0 ? (
            query ? (
                <div className="p-4">
                  <EmptyState
                    icon={ListTodo}
                    title="Sin resultados"
                    description={`No encontramos pendientes que coincidan con "${query}".`}
                  />
                </div>
              ) : (
                <div className="p-4">
                  <EmptyState
                    icon={ListTodo}
                    title="Sin pendientes activos"
                    description="¡Bandeja limpia! Cuando llegue trabajo nuevo aparecerá aquí."
                    action="Nuevo pendiente"
                    actionHref="/tasks/new"
                  />
                </div>
              )
            ) : pagedWorkItems.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={ListTodo}
                  title="Página fuera de rango"
                  description="No hay pendientes en esta página. Vuelve al inicio del listado."
                  action="Volver al inicio"
                  actionHref={buildTableHref("/tasks", params, { q: query || null })}
                />
              </div>
            ) : (
              <>
                <WorkItemsTable workItems={workItemRows} />
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={filteredCount}
                  basePath="/tasks"
                  searchParams={{ q: query }}
                />
              </>
            )}
          </SectionCard>

          <SectionCard title="Urgentes y vencidas" description="Casos que deberían moverse antes que el resto.">
            {[...new Map([...urgentWorkItemRows, ...overdueWorkItemRows].map((workItem) => [workItem.id, workItem])).values()].length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Flame}
                  title="Nada urgente"
                  description="No hay pendientes urgentes ni vencidos en este momento."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {[...new Map([...urgentWorkItemRows, ...overdueWorkItemRows].map((workItem) => [workItem.id, workItem])).values()]
                  .slice(0, 10)
                  .map((workItem) => (
                    <div key={workItem.id} className="flex items-start justify-between gap-4 px-4 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{workItem.folio}</span>
                          <PriorityBadge priority={workItem.priority} />
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{workItem.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {workItem.client?.fullName ?? "Sin cliente"} · {workItem.policy?.policyNumber ?? "Sin póliza"}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={workItem.status} className="w-fit" />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {workItem.dueDate ? `${formatDate(workItem.dueDate)} · ${daysUntil(workItem.dueDate)} días` : "Sin fecha"}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </SectionCard>
        </section>
      </div>
    </div>
  );
}
