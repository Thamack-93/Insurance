import { createClaim } from "@/app/(dashboard)/claims/actions";
import { ClaimForm } from "@/components/forms/claim-form";
import { createClaimDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantOrganization } from "@/lib/tenant-dal";
import {
  clientOperationalWhere,
  policyOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";

export default async function NewClaimPage() {
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
  const [clients, policies, insurers] = await Promise.all([
    db.client.findMany({
      where: {
        ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        status: { not: "ARCHIVED" },
      },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: {
        ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        status: { not: "CANCELLED" },
      },
      orderBy: { policyNumber: "asc" },
      select: { id: true, policyNumber: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const policyOptions = policies.map((p) => ({ value: p.id, label: p.policyNumber }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Nuevo siniestro"
          description="Registra un nuevo siniestro en el sistema."
        />

        <ClaimForm
          title="Nuevo siniestro"
          description="Completa los datos para registrar un nuevo siniestro."
          submitLabel="Crear siniestro"
          cancelHref="/claims"
          defaultValues={createClaimDefaults()}
          clientOptions={clientOptions}
          policyOptions={policyOptions}
          insurerOptions={insurerOptions}
          submitAction={createClaim}
        />
      </div>
    </div>
  );
  });
}
