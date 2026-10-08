import { notFound } from "next/navigation";
import { updateWorkItem } from "@/app/(dashboard)/tasks/actions";
import { WorkItemForm } from "@/components/forms/task-form";
import { createWorkItemDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantTransaction } from "@/lib/organization-context";
import { formatDateInput } from "@/lib/form-utils";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";
import type { WorkItemFormValues } from "@/lib/validations";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function EditWorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const [workItem, clients, insurers] = await withTenantTransaction(scope.context, async (db) => {
    const workItem = await findWorkItemByRouteId(id, scope.organizationId, db, scope.portfolioOwnerId);
    const clients = await db.client.findMany({
      where: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { portfolioOwnerId: scope.portfolioOwnerId } : {}), status: { not: "ARCHIVED" } },
      orderBy: { fullName: "asc" },
      take: 100,
      select: { id: true, fullName: true },
    });
    const insurers = await db.insurer.findMany({
      where: { organizationId: scope.organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true },
    });
    if (workItem?.clientId && !clients.some((client) => client.id === workItem.clientId)) {
      const selectedClient = await db.client.findFirst({
        where: { id: workItem.clientId, organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { portfolioOwnerId: scope.portfolioOwnerId } : {}) },
        select: { id: true, fullName: true },
      });
      if (selectedClient) clients.push(selectedClient);
    }
    if (workItem?.insurerId && !insurers.some((insurer) => insurer.id === workItem.insurerId)) {
      const selectedInsurer = await db.insurer.findFirst({
        where: { id: workItem.insurerId, organizationId: scope.organizationId },
        select: { id: true, name: true },
      });
      if (selectedInsurer) insurers.push(selectedInsurer);
    }
    return [workItem, clients, insurers] as const;
  });

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
          description="Los cambios afectan Hoy, Insights, renovaciones y cobranza cuando aplique."
          submitLabel="Guardar cambios"
          cancelHref="/tasks"
          defaultValues={createWorkItemDefaults({
            clientId: workItem.clientId ?? "",
            policyId: workItem.policyId ?? "",
            insurerId: workItem.insurerId ?? "",
            receiptId: workItem.receiptId ?? "",
            title: workItem.title,
            description: workItem.description ?? "",
            taskType: (workItem.taskType ?? "GENERAL") as WorkItemFormValues["taskType"],
            status: (workItem.status === "DISMISSED" ? "ARCHIVED" : workItem.status) as WorkItemFormValues["status"],
            priority: workItem.priority as WorkItemFormValues["priority"],
            startDate: formatDateInput(workItem.startDate),
            dueDate: formatDateInput(workItem.dueDate),
            notes: workItem.notes ?? "",
          })}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          submitAction={updateWorkItem.bind(null, workItem.sourceId ?? workItem.id)}
        />
      </div>
    </div>
  );
}
