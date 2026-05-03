import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Flame, ListTodo, MessageSquareWarning, Plus } from "lucide-react";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { TasksTable, type TaskRow } from "@/components/tasks/tasks-table";

const PAGE_SIZE = 25;
const INACTIVE_STATUSES = ["RESOLVED", "CANCELLED", "ARCHIVED"] as const satisfies readonly TaskStatus[];
const ACTIVE_STATUS_FILTER = { notIn: [...INACTIVE_STATUSES] };

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();
  const now = today();

  const baseWhere: Prisma.TaskWhereInput = { status: ACTIVE_STATUS_FILTER };
  const where: Prisma.TaskWhereInput = query
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { folio: { contains: query } },
              { title: { contains: query } },
              { client: { fullName: { contains: query } } },
              { policy: { policyNumber: { contains: query } } },
            ],
          },
        ],
      }
    : baseWhere;

  const [
    activeCount,
    urgentCount,
    overdueCount,
    dueSoonCount,
    waitingClientCount,
    filteredCount,
    pagedTasks,
    urgentTasks,
    overdueTasks,
  ] = await Promise.all([
    db.task.count({ where: baseWhere }),
    db.task.count({ where: { status: ACTIVE_STATUS_FILTER, priority: "URGENT" } }),
    db.task.count({ where: { status: ACTIVE_STATUS_FILTER, dueDate: { lt: now } } }),
    db.task.count({
      where: {
        status: ACTIVE_STATUS_FILTER,
        dueDate: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    db.task.count({ where: { status: "WAITING_CLIENT" } }),
    db.task.count({ where }),
    db.task.findMany({
      where,
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.task.findMany({
      where: { priority: "URGENT", status: ACTIVE_STATUS_FILTER },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.task.findMany({
      where: { dueDate: { lt: now }, status: ACTIVE_STATUS_FILTER },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
  ]);

  const taskRows: TaskRow[] = pagedTasks.map((task) => ({
    id: task.id,
    folio: task.folio,
    title: task.title,
    taskType: task.taskType,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate ? formatDate(task.dueDate) : null,
    dueDays: task.dueDate ? daysUntil(task.dueDate) : null,
    clientId: task.clientId,
    clientName: task.client?.fullName ?? null,
    policyId: task.policyId,
    policyNumber: task.policy?.policyNumber ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Tareas"
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
            description="Tareas que todavía requieren seguimiento."
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
            description="Tareas con fecha límite ya superada."
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
            action={<ListSearch placeholder="Buscar por folio, título, cliente o póliza..." />}
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
            ) : pagedTasks.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={ListTodo}
                  title="Página fuera de rango"
                  description="No hay pendientes en esta página. Vuelve al inicio del listado."
                  action="Volver al inicio"
                  actionHref={query ? `/tasks?q=${encodeURIComponent(query)}` : "/tasks"}
                />
              </div>
            ) : (
              <>
                <TasksTable tasks={taskRows} />
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
            {[...new Map([...urgentTasks, ...overdueTasks].map((t) => [t.id, t])).values()].length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Flame}
                  title="Nada urgente"
                  description="No hay tareas urgentes ni vencidas en este momento."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {[...new Map([...urgentTasks, ...overdueTasks].map((t) => [t.id, t])).values()]
                  .slice(0, 10)
                  .map((task) => (
                    <div key={task.id} className="flex items-start justify-between gap-4 px-4 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{task.folio}</span>
                          <PriorityBadge priority={task.priority} />
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{task.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {task.client?.fullName ?? "Sin cliente"} · {task.policy?.policyNumber ?? "Sin póliza"}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={task.status} className="w-fit" />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {task.dueDate ? `${formatDate(task.dueDate)} · ${daysUntil(task.dueDate)} días` : "Sin fecha"}
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
