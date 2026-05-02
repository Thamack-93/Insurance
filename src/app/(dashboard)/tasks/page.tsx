import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Flame, MessageSquareWarning, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";

const taskTypeLabels: Record<string, string> = {
  GENERAL: "General",
  CLAIM: "Siniestro",
  QUOTE: "Cotización",
  RENEWAL: "Renovación",
  PAYMENT: "Cobranza",
  DOCUMENT: "Documento",
  COMMISSION: "Comisión",
  OTHER: "Otro",
};

export default async function TasksPage() {
  const db = getDb();
  const now = today();

  const [openTasks, urgentTasks, overdueTasks, waitingClients, allActiveTasks] = await Promise.all([
    db.task.findMany({
      where: { status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 10,
    }),
    db.task.findMany({
      where: {
        priority: "URGENT",
        status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.task.findMany({
      where: {
        dueDate: { lt: now },
        status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.task.findMany({
      where: {
        status: "WAITING_CLIENT",
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.task.findMany({
      where: { status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] } },
      include: { client: true, policy: true, insurer: true },
    }),
  ]);

  const activeTaskCount = allActiveTasks.length;
  const urgentCount = allActiveTasks.filter((task) => task.priority === "URGENT").length;
  const dueSoonCount = allActiveTasks.filter((task) => task.dueDate && daysUntil(task.dueDate) <= 7).length;
  const overdueCount = allActiveTasks.filter((task) => task.dueDate && daysUntil(task.dueDate) < 0).length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Tareas"
          description="Pendientes vivos, urgentes y bloqueos con cliente o aseguradora."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Pendientes activos"
            value={activeTaskCount}
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
            description={`${waitingClients.length} casos en espera de documentación o respuesta.`}
            icon={MessageSquareWarning}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <SectionCard title="Cola principal" description="Ordenada por prioridad y vencimiento.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Folio</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.folio}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{task.title}</TableCell>
                    <TableCell>
                      {task.client ? (
                        <Link href={`/clients/${task.clientId}`} className="text-foreground hover:text-primary">
                          {task.client.fullName}
                        </Link>
                      ) : (
                        "Sin cliente"
                      )}
                    </TableCell>
                    <TableCell>
                      {task.policy ? (
                        <Link href={`/policies/${task.policyId}`} className="text-foreground hover:text-primary">
                          {task.policy.policyNumber}
                        </Link>
                      ) : (
                        "Sin póliza"
                      )}
                    </TableCell>
                    <TableCell>{taskTypeLabels[task.taskType] ?? task.taskType}</TableCell>
                    <TableCell>
                      {task.dueDate ? (
                        <span className="text-sm text-muted-foreground">
                          {formatDate(task.dueDate)} · {daysUntil(task.dueDate)} días
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin fecha</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <PriorityBadge priority={task.priority} />
                        <StatusBadge status={task.status} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Urgentes y vencidas" description="Casos que deberían moverse antes que el resto.">
            <div className="divide-y divide-stone-200/80">
              {[...urgentTasks, ...overdueTasks]
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
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
