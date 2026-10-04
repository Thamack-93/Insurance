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
import { getPolicyOptionLabel } from "@/lib/policy-identity";

export default async function EditWorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const [workItem, clients, policies, insurers, receipts] = await withTenantTransaction(scope.context, async (db) => {
    const workItem = await findWorkItemByRouteId(id, scope.organizationId, db, scope.portfolioOwnerId);
    const clients = await db.client.findMany({
      where: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { portfolioOwnerId: scope.portfolioOwnerId } : {}), status: { not: "ARCHIVED" } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    });
    const policies = await db.policy.findMany({
      where: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { client: { portfolioOwnerId: scope.portfolioOwnerId } } : {}), status: { not: "CANCELLED" } },
      orderBy: { policyNumber: "asc" },
      select: {
        id: true,
        policyNumber: true,
        insuredObject: true,
        insuredAssets: { select: { description: true, isPrimary: true } },
      },
    });
    const insurers = await db.insurer.findMany({
      where: { organizationId: scope.organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const receipts = await db.receipt.findMany({
      where: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { client: { portfolioOwnerId: scope.portfolioOwnerId } } : {}), status: { not: "CANCELLED" } },
      orderBy: { dueDate: "asc" },
      select: { id: true, receiptNumber: true },
    });
    return [workItem, clients, policies, insurers, receipts] as const;
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
          policyOptions={policies.map((policy) => ({ value: policy.id, label: getPolicyOptionLabel(policy) }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          receiptOptions={receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber }))}
          submitAction={updateWorkItem.bind(null, workItem.sourceId ?? workItem.id)}
        />
      </div>
    </div>
  );
}
