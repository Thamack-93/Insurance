import { notFound } from "next/navigation";
import { updateWorkItem } from "@/app/(dashboard)/tasks/actions";
import { WorkItemForm } from "@/components/forms/task-form";
import { createWorkItemDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";

export default async function EditWorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [workItem, clients, policies, insurers, receipts] = await Promise.all([
    findWorkItemByRouteId(id, db),
    db.client.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { policyNumber: "asc" },
      select: { id: true, policyNumber: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.receipt.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: { dueDate: "asc" },
      select: { id: true, receiptNumber: true },
    }),
  ]);

  if (!workItem) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Editar ${workItem.folio ?? workItem.sourceId ?? workItem.id}`}
          description="Actualiza prioridad, estado o relaciones del pendiente sin perder historial."
        />

        <WorkItemForm
          title="Edición de pendiente"
          description="Los cambios afectan Hoy, Dashboard, renovaciones y cobranza cuando aplique."
          submitLabel="Guardar cambios"
          cancelHref="/tasks"
          defaultValues={createWorkItemDefaults({
            clientId: workItem.clientId ?? "",
            policyId: workItem.policyId ?? "",
            insurerId: workItem.insurerId ?? "",
            receiptId: workItem.receiptId ?? "",
            title: workItem.title,
            description: workItem.description ?? "",
            taskType: workItem.taskType ?? "GENERAL",
            status: workItem.status === "DISMISSED" ? "ARCHIVED" : workItem.status,
            priority: workItem.priority,
            startDate: formatDateInput(workItem.startDate),
            dueDate: formatDateInput(workItem.dueDate),
            notes: workItem.notes ?? "",
          })}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          policyOptions={policies.map((policy) => ({ value: policy.id, label: policy.policyNumber }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          receiptOptions={receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber }))}
          submitAction={updateWorkItem.bind(null, workItem.sourceId ?? workItem.id)}
        />
      </div>
    </div>
  );
}
