import { notFound } from "next/navigation";
import { updateClient } from "@/app/(dashboard)/clients/actions";
import { ClientForm } from "@/components/forms/client-form";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { createClientDefaults } from "@/lib/form-defaults";
import { formatDateInput } from "@/lib/form-utils";
import type { SelectOption } from "@/lib/domain-options";
import type { ClientFormValues } from "@/lib/validations";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
  const [client, referidorClients] = await Promise.all([
    db.client.findFirst({ where: { id, organizationId: scope.organizationId } }),
    db.client.findMany({
      where: { id: { not: id }, organizationId: scope.organizationId },
      select: { id: true, fullName: true, type: true },
      orderBy: [{ fullName: "asc" }],
    }),
  ]);

  if (!client) {
    notFound();
  }

  const referidorOptions: SelectOption[] = referidorClients.map((item) => ({
    value: item.id,
    label: `${item.fullName} · ${item.type === "COMPANY" ? "Empresa" : "Persona"}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={`Editar ${client.fullName}`}
          description="Actualiza el expediente del cliente sin perder trazabilidad operativa."
        />

        <ClientForm
          title="Edición de cliente"
          description="Los cambios se validan antes de guardar y se registran en ActivityLog."
          submitLabel="Guardar cambios"
          cancelHref={`/clients/${client.id}`}
          defaultValues={createClientDefaults({
            fullName: client.fullName,
            type: client.type as ClientFormValues["type"],
            email: client.email ?? "",
            phone: client.phone ?? "",
            secondaryPhone: client.secondaryPhone ?? "",
            rfc: client.rfc ?? "",
            address: client.address ?? "",
            birthDate: formatDateInput(client.birthDate),
            preferredContactMethod: client.preferredContactMethod ?? "",
            referidorId: client.referidorId ?? "NONE",
            notes: client.notes ?? "",
            status: client.status as ClientFormValues["status"],
          })}
          referidorOptions={referidorOptions}
          submitAction={updateClient.bind(null, client.id)}
        />
      </div>
    </div>
  );
  });
}
