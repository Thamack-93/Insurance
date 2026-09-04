import { notFound } from "next/navigation";
import { updateClaim } from "@/app/(dashboard)/claims/actions";
import { ClaimForm } from "@/components/forms/claim-form";
import { createClaimDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { formatDateInput } from "@/lib/form-utils";
import type { ClaimFormValues } from "@/lib/validations";
import {
  claimOperationalWhere,
  clientOperationalWhere,
  policyOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";

export default async function EditClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
  const [claim, clients, policies, insurers] = await Promise.all([
    db.claim.findFirst({ where: { id, ...claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId) } }),
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

  if (!claim) {
    notFound();
  }

  const clientOptions = clients.map((c) => ({ value: c.id, label: c.fullName }));
  const policyOptions = policies.map((p) => ({ value: p.id, label: p.policyNumber }));
  const insurerOptions = insurers.map((i) => ({ value: i.id, label: i.name }));

  const defaultValues = createClaimDefaults({
    folio: claim.folio,
    clientId: claim.clientId,
    policyId: claim.policyId,
    insurerId: claim.insurerId,
    claimType: claim.claimType as ClaimFormValues["claimType"],
    description: claim.description ?? "",
    status: claim.status as ClaimFormValues["status"],
    incidentDate: formatDateInput(claim.incidentDate),
    reportedDate: formatDateInput(claim.reportedDate),
    closedDate: formatDateInput(claim.closedDate),
    amountClaimed: claim.amountClaimed ? Number(claim.amountClaimed) : undefined,
    amountPaid: claim.amountPaid ? Number(claim.amountPaid) : undefined,
    notes: claim.notes ?? "",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Editar ${claim.folio}`}
          description="Actualiza los datos del siniestro."
        />

        <ClaimForm
          title="Editar siniestro"
          description="Modifica la información del siniestro."
          submitLabel="Guardar cambios"
          cancelHref={`/claims/${id}`}
          defaultValues={defaultValues}
          clientOptions={clientOptions}
          policyOptions={policyOptions}
          insurerOptions={insurerOptions}
          submitAction={updateClaim.bind(null, id)}
        />
      </div>
    </div>
  );
  });
}
