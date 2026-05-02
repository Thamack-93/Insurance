import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckSquare, ClipboardList, FileText, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysSince, daysUntil, formatDate } from "@/lib/dates";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";

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

const taskStatusLabels: Record<string, string> = {
  OPEN: "Abierta",
  IN_PROGRESS: "En progreso",
  WAITING_CLIENT: "Esperando cliente",
  WAITING_INSURER: "Esperando aseguradora",
  WAITING_DOCUMENT: "Esperando documento",
  SENT: "Enviada",
  RESOLVED: "Resuelta",
  CANCELLED: "Cancelada",
  ARCHIVED: "Archivada",
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const task = await db.task.findUnique({
    where: { id },
    include: { client: true, policy: true, insurer: true, receipt: true },
  });

  if (!task) {
    notFound();
  }

  const [documents, activityLogs] = await Promise.all([
    db.document.findMany({
      where: { taskId: id },
      orderBy: { uploadedAt: "desc" },
    }),
    db.activityLog.findMany({
      where: { entityType: "Task", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const isClosed = task.status === "RESOLVED" || task.status === "CANCELLED" || task.status === "ARCHIVED";
  const isOverdue = task.dueDate && task.dueDate < new Date() && !isClosed;
  const daysActive = daysSince(task.startDate);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={task.folio}
          description={task.title}
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href={`/tasks/${task.id}/edit`}>Editar tarea</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/tasks">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Estado"
            value={taskStatusLabels[task.status] ?? task.status}
            description={isClosed ? "Tarea cerrada" : isOverdue ? "Vencida" : "Activa"}
            icon={CheckSquare}
            tone={isClosed ? "blue" : isOverdue ? "rose" : "emerald"}
          />
          <MetricCard
            title="Prioridad"
            value={task.priority}
            description="Nivel de urgencia asignado"
            icon={ClipboardList}
            tone={task.priority === "URGENT" ? "rose" : task.priority === "HIGH" ? "amber" : "blue"}
          />
          <MetricCard
            title="Días activa"
            value={daysActive}
            description={`Iniciada el ${formatDate(task.startDate)}`}
            icon={CalendarClock}
            tone="blue"
          />
          <MetricCard
            title="Tipo"
            value={taskTypeLabels[task.taskType] ?? task.taskType}
            description="Clasificación operativa"
            icon={FileText}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha del pendiente" description="Contexto, relaciones y seguimiento.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-2">
                  <PriorityBadge priority={task.priority} />
                  <StatusBadge status={task.status} />
                </div>
                <Badge variant="outline" className="rounded-full">
                  {taskTypeLabels[task.taskType] ?? task.taskType}
                </Badge>
              </div>

              <div className="rounded-2xl border bg-stone-50/70 p-4">
                <p className="font-medium text-foreground">Título</p>
                <p className="mt-1">{task.title}</p>
                {task.description ? (
                  <>
                    <p className="mt-3 font-medium text-foreground">Descripción</p>
                    <p className="mt-1 text-muted-foreground">{task.description}</p>
                  </>
                ) : null}
              </div>

              <div className="grid gap-3">
                {task.client ? (
                  <div>
                    <p className="text-muted-foreground">Cliente</p>
                    <Link href={`/clients/${task.clientId}`} className="font-medium text-foreground hover:text-primary">
                      {task.client.fullName}
                    </Link>
                  </div>
                ) : null}
                {task.policy ? (
                  <div>
                    <p className="text-muted-foreground">Póliza</p>
                    <Link href={`/policies/${task.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {task.policy.policyNumber}
                    </Link>
                  </div>
                ) : null}
                {task.insurer ? (
                  <div>
                    <p className="text-muted-foreground">Aseguradora</p>
                    <p className="font-medium">{task.insurer.name}</p>
                  </div>
                ) : null}
                {task.receipt ? (
                  <div>
                    <p className="text-muted-foreground">Recibo</p>
                    <Link href={`/receipts/${task.receiptId}`} className="font-medium text-foreground hover:text-primary">
                      {task.receipt.receiptNumber}
                    </Link>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Fecha de inicio</p>
                  <p className="font-medium">{formatDate(task.startDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fecha límite</p>
                  <p className={`font-medium ${isOverdue ? "text-rose-600" : ""}`}>
                    {task.dueDate ? formatDate(task.dueDate) : "Sin fecha"}
                    {task.dueDate ? ` · ${daysUntil(task.dueDate)} días` : ""}
                  </p>
                </div>
              </div>

              {task.closedDate ? (
                <div>
                  <p className="text-muted-foreground">Fecha de cierre</p>
                  <p className="font-medium">{formatDate(task.closedDate)}</p>
                </div>
              ) : null}

              {task.notes ? (
                <div className="rounded-2xl border bg-white/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas internas</p>
                  <p className="mt-1">{task.notes}</p>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Documentos" description="Archivos adjuntos a este pendiente.">
            {documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay documentos asociados a este pendiente.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Archivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">{document.fileName}</TableCell>
                      <TableCell>{document.documentType}</TableCell>
                      <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </section>

        <SectionCard title="Historial de actividad" description="Cambios y eventos registrados.">
          {activityLogs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No hay actividad registrada para este pendiente.
            </div>
          ) : (
            <div className="p-4">
              <ActivityTimeline items={activityLogs} />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Comunicación" description="Resumen de interacciones relacionadas.">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-white/70 p-4">
              <div className="flex items-center gap-3">
                <MessageSquare className="size-4 text-muted-foreground" />
                <p className="font-medium">Estado actual</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {isClosed
                  ? "Este pendiente está cerrado. No requiere seguimiento activo."
                  : isOverdue
                    ? "Este pendiente está vencido. Requiere atención prioritaria."
                    : "Este pendiente está activo y en seguimiento normal."}
              </p>
            </div>
            <div className="rounded-2xl border bg-white/70 p-4">
              <div className="flex items-center gap-3">
                <CalendarClock className="size-4 text-muted-foreground" />
                <p className="font-medium">Próximos pasos</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {task.status === "WAITING_CLIENT"
                  ? "En espera de respuesta o documentación del cliente."
                  : task.status === "WAITING_INSURER"
                    ? "En espera de respuesta de la aseguradora."
                    : task.status === "WAITING_DOCUMENT"
                      ? "En espera de documentos para continuar el trámite."
                      : "Continuar con el seguimiento según prioridad y fecha límite."}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
