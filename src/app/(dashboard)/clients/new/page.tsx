import { withTenantOrganization } from "@/lib/tenant-dal";
import { PageHeader } from "@/components/layout/page-header";
import { ClientForm } from "@/components/forms/client-form";
import { createClient } from "@/app/(dashboard)/clients/actions";
import { createClientDefaults } from "@/lib/form-defaults";
import type { SelectOption } from "@/lib/domain-options";
import { clientOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function NewClientPage() {
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
  const clients = await db.client.findMany({
    where: clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
    select: { id: true, fullName: true, type: true },
    orderBy: [{ fullName: "asc" }],
  });

  const referidorOptions: SelectOption[] = clients.map((client) => ({
    value: client.id,
    label: `${client.fullName} · ${client.type === "COMPANY" ? "Empresa" : "Persona"}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Nuevo cliente"
          description="Crea un expediente operable con datos de contacto, estado y contexto comercial."
        />

        <ClientForm
          title="Alta de cliente"
          description="Este formulario crea el expediente base y registra el evento en ActivityLog."
          submitLabel="Crear cliente"
          cancelHref="/clients"
          defaultValues={createClientDefaults()}
          referidorOptions={referidorOptions}
          submitAction={createClient}
        />
      </div>
    </div>
  );
  });
}
