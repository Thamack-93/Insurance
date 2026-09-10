import { createWorkItem } from "@/app/(dashboard)/tasks/actions";
import { WorkItemForm } from "@/components/forms/task-form";
import { createWorkItemDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantTransaction } from "@/lib/organization-context";
import { clientOperationalWhere, policyOperationalWhere, receiptOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function NewWorkItemPage() {
  const scope = await requireOrganizationPortfolioReadScope();
  const [clients, policies, insurers, receipts] = await withTenantTransaction(scope.context, (db) => Promise.all([
    db.client.findMany({
      where: { status: { not: "ARCHIVED" }, ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: { status: { not: "CANCELLED" }, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      orderBy: { policyNumber: "asc" },
      select: { id: true, policyNumber: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" }, organizationId: scope.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.receipt.findMany({
      where: { status: { not: "CANCELLED" }, ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      orderBy: { dueDate: "asc" },
      select: { id: true, receiptNumber: true },
    }),
  ]));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Nuevo pendiente"
          description="Convierte seguimiento operativo en un WorkItem trazable y accionable."
        />

        <WorkItemForm
          title="Alta de pendiente"
          description="Puedes ligarlo a cliente, póliza, aseguradora o recibo según el contexto."
          submitLabel="Crear pendiente"
          cancelHref="/tasks"
          defaultValues={createWorkItemDefaults()}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          policyOptions={policies.map((policy) => ({ value: policy.id, label: policy.policyNumber }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          receiptOptions={receipts.map((receipt) => ({ value: receipt.id, label: receipt.receiptNumber }))}
          submitAction={createWorkItem}
        />
      </div>
    </div>
  );
}
