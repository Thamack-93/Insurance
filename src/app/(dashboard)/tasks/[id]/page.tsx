import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckSquare, ClipboardList, FileText, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { AuditByline } from "@/components/audit/audit-byline";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { PriorityBadge, StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteWorkItemButton } from "@/components/tasks/delete-task-button";
import { getDb } from "@/lib/db";
import { daysSince, daysUntil, formatDate } from "@/lib/dates";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";

const workItemTypeLabels: Record<string, string> = {
  GENERAL: "General",
  CLAIM: "Siniestro",
  QUOTE: "Cotización",
  RENEWAL: "Renovación",
  PAYMENT: "Cobranza",
  DOCUMENT: "Documento",
  COMMISSION: "Comisión",
  OTHER: "Otro",
};

const workItemStatusLabels: Record<string, string> = {
  OPEN: "Abierta",
  IN_PROGRESS: "En progreso",
  WAITING_CLIENT: "Esperando cliente",
  WAITING_INSURER: "Esperando aseguradora",
  WAITING_DOCUMENT: "Esperando documento",
  SENT: "Enviada",
  RESOLVED: "Resuelta",
  CANCELLED: "Cancelada",
  ARCHIVED: "Archivada",
  DISMISSED: "Descartada",
};

export default async function WorkItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const workItem = await findWorkItemByRouteId(id, db);

  if (!workItem) {
    notFound();
  }

  const [documents, activityLogs] = await Promise.all([
    db.document.findMany({
      where: { taskId: id },
      orderBy: { uploadedAt: "desc" },
    }),
    db.activityLog.findMany({
      where: {
        entityId: id,
        OR: [{ entityType: "WorkItem" }, { entityType: "Task" }],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const isClosed = workItem.status === "RESOLVED" || workItem.status === "CANCELLED" || workItem.status === "ARCHIVED" || workItem.status === "DISMISSED";
  const isOverdue = workItem.dueDate && workItem.dueDate < new Date() && !isClosed;
  const daysActive = daysSince(workItem.startDate);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={workItem.folio ?? workItem.sourceId ?? workItem.id}
          description={workItem.title}
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/tasks/${workItem.sourceId ?? workItem.id}/edit`}>Editar pendiente</Link>
              </Button>
              <DeleteWorkItemButton id={workItem.sourceId ?? workItem.id} folio={workItem.folio ?? workItem.sourceId ?? workItem.id} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/tasks">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </>
          }
        />

        <AuditByline createdById={workItem.createdById} updatedById={workItem.updatedById} />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Estado"
            value={workItemStatusLabels[workItem.status] ?? workItem.status}
            description={isClosed ? "Pendiente cerrada" : isOverdue ? "Vencida" : "Activa"}
            icon={CheckSquare}
            tone={isClosed ? "blue" : isOverdue ? "rose" : "emerald"}
          />
          <MetricCard
            title="Prioridad"
            value={workItem.priority}
            description="Nivel de urgencia asignado"
            icon={ClipboardList}
            tone={workItem.priority === "URGENT" ? "rose" : workItem.priority === "HIGH" ? "amber" : "blue"}
          />
          <MetricCard
            title="Días activa"
            value={daysActive}
            description={`Iniciada el ${formatDate(workItem.startDate)}`}
            icon={CalendarClock}
            tone="blue"
          />
          <MetricCard
            title="Tipo"
            value={workItemTypeLabels[workItem.taskType ?? "GENERAL"] ?? workItem.taskType ?? "GENERAL"}
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
                  <PriorityBadge priority={workItem.priority} />
                  <StatusBadge status={workItem.status} />
                </div>
                <Badge variant="outline" className="rounded-full">
                  {workItemTypeLabels[workItem.taskType ?? "GENERAL"] ?? workItem.taskType ?? "GENERAL"}
                </Badge>
              </div>

              <div className="rounded-2xl border bg-muted/40 p-4">
                <p className="font-medium text-foreground">Título</p>
                <p className="mt-1">{workItem.title}</p>
                {workItem.description ? (
                  <>
                    <p className="mt-3 font-medium text-foreground">Descripción</p>
                    <p className="mt-1 text-muted-foreground">{workItem.description}</p>
                  </>
                ) : null}
              </div>

              <div className="grid gap-3">
                {workItem.client ? (
                  <div>
                    <p className="text-muted-foreground">Cliente</p>
                    <Link href={`/clients/${workItem.clientId}`} className="font-medium text-foreground hover:text-primary">
                      {workItem.client.fullName}
                    </Link>
                  </div>
                ) : null}
                {workItem.policy ? (
                  <div>
                    <p className="text-muted-foreground">Póliza</p>
                    <Link href={`/policies/${workItem.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {workItem.policy.policyNumber}
                    </Link>
                  </div>
                ) : null}
                {workItem.insurer ? (
                  <div>
                    <p className="text-muted-foreground">Aseguradora</p>
                    <p className="font-medium">{workItem.insurer.name}</p>
                  </div>
                ) : null}
                {workItem.receipt ? (
                  <div>
                    <p className="text-muted-foreground">Recibo</p>
                    <Link href={`/receipts/${workItem.receiptId}`} className="font-medium text-foreground hover:text-primary">
                      {workItem.receipt.receiptNumber}
                    </Link>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Fecha de inicio</p>
                  <p className="font-medium">{formatDate(workItem.startDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fecha límite</p>
                  <p className={`font-medium ${isOverdue ? "text-rose-600" : ""}`}>
                    {workItem.dueDate ? formatDate(workItem.dueDate) : "Sin fecha"}
                    {workItem.dueDate ? ` · ${daysUntil(workItem.dueDate)} días` : ""}
                  </p>
                </div>
              </div>

              {workItem.closedDate ? (
                <div>
                  <p className="text-muted-foreground">Fecha de cierre</p>
                  <p className="font-medium">{formatDate(workItem.closedDate)}</p>
                </div>
              ) : null}

              {workItem.notes ? (
                <div className="rounded-2xl border bg-card/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas internas</p>
                  <p className="mt-1">{workItem.notes}</p>
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
                  <TableRow className="bg-muted/40">
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

        <SectionCard
          title="Actividad"
          description="Cambios y eventos registrados para este pendiente."
          action={
            <Link
              href={`/activity?entity=WorkItem&id=${workItem.sourceId ?? workItem.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver todo el historial
            </Link>
          }
        >
          {activityLogs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No hay actividad registrada para este pendiente.
            </div>
          ) : (
            <ActivityTimeline entries={activityLogs} />
          )}
        </SectionCard>

        <SectionCard title="Comunicación" description="Resumen de interacciones relacionadas.">
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-card/70 p-4">
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
            <div className="rounded-2xl border bg-card/70 p-4">
              <div className="flex items-center gap-3">
                <CalendarClock className="size-4 text-muted-foreground" />
                <p className="font-medium">Próximos pasos</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {workItem.status === "WAITING_CLIENT"
                  ? "En espera de respuesta o documentación del cliente."
                  : workItem.status === "WAITING_INSURER"
                    ? "En espera de respuesta de la aseguradora."
                    : workItem.status === "WAITING_DOCUMENT"
                      ? "En espera de documentos para continuar el trámite."
                      : "Continuar con el seguimiento según prioridad y fecha límite."}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
