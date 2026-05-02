import { notFound } from "next/navigation";
import { updateTask } from "@/app/(dashboard)/tasks/actions";
import { TaskForm } from "@/components/forms/task-form";
import { createTaskDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [task, clients, policies, insurers, receipts] = await Promise.all([
    db.task.findUnique({ where: { id } }),
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

  if (!task) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Editar ${task.folio}`}
          description="Actualiza prioridad, estado o relaciones del pendiente sin perder historial."
        />

        <TaskForm
          title="Edición de pendiente"
          description="Los cambios afectan Hoy, Dashboard, renovaciones y cobranza cuando aplique."
          submitLabel="Guardar cambios"
          cancelHref="/tasks"
          defaultValues={createTaskDefaults({
            clientId: task.clientId ?? "",
            policyId: task.policyId ?? "",
            insurerId: task.insurerId ?? "",
            receiptId: task.receiptId ?? "",
            title: task.title,
            description: task.description ?? "",
            taskType: task.taskType,
            status: task.status,
            priority: task.priority,
            startDate: formatDateInput(task.startDate),
            dueDate: formatDateInput(task.dueDate),
            notes: task.notes ?? "",
          })}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          policyOptions={policies.map((policy) => ({ value: policy.id, label: policy.policyNumber }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          receiptOptions={receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber }))}
          submitAction={updateTask.bind(null, task.id)}
        />
      </div>
    </main>
  );
}