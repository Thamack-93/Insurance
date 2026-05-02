import { createTask } from "@/app/(dashboard)/tasks/actions";
import { TaskForm } from "@/components/forms/task-form";
import { createTaskDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function NewTaskPage() {
  const db = getDb();
  const [clients, policies, insurers, receipts] = await Promise.all([
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

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Nuevo pendiente"
          description="Convierte seguimiento operativo en una tarea trazable y accionable."
        />

        <TaskForm
          title="Alta de pendiente"
          description="Puedes ligarlo a cliente, póliza, aseguradora o recibo según el contexto."
          submitLabel="Crear pendiente"
          cancelHref="/tasks"
          defaultValues={createTaskDefaults()}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          policyOptions={policies.map((policy) => ({ value: policy.id, label: policy.policyNumber }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          receiptOptions={receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber }))}
          submitAction={createTask}
        />
      </div>
    </main>
  );
}