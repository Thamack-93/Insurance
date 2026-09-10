import Link from "next/link";
import { notFound } from "next/navigation";
import { updateEndorsement } from "@/app/(dashboard)/policies/endorsements/actions";
import { EndorsementForm } from "@/components/forms/endorsement-form";
import { createEndorsementDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantTransaction } from "@/lib/organization-context";
import { formatDate } from "@/lib/dates";
import { formatDateInput } from "@/lib/form-utils";
import type { EndorsementFormValues } from "@/lib/validations";
import {
  endorsementOperationalWhere,
  policyOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";

export default async function EditEndorsementPage({
  params,
}: {
  params: Promise<{ id: string; endorsementId: string }>;
}) {
  const { id, endorsementId } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const [policy, endorsement] = await withTenantTransaction(scope.context, (db) => Promise.all([
    db.policy.findFirst({
      where: { id, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: { client: true, insurer: true },
    }),
    db.policyEndorsement.findFirst({
      where: { id: endorsementId, ...endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: { policy: { include: { client: true, insurer: true } } },
    }),
  ]));

  if (!policy || !endorsement || endorsement.policyId !== policy.id) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Póliza"
          title={`Editar endoso ${endorsement.endorsementNumber}`}
          description="Actualiza el ajuste sin moverlo fuera de la póliza base."
        />

        <EndorsementForm
          title="Edición de endoso"
          description="Los cambios actualizan la póliza base, la cartera y el documento asociado."
          submitLabel="Guardar cambios"
          cancelHref={`/policies/${policy.id}`}
          defaultValues={createEndorsementDefaults({
            endorsementNumber: endorsement.endorsementNumber,
            policyId: endorsement.policyId,
            status: endorsement.status as EndorsementFormValues["status"],
            startDate: formatDateInput(endorsement.startDate),
            endDate: formatDateInput(endorsement.endDate),
            amount: Number(endorsement.amount),
            currency: endorsement.currency,
            reference: endorsement.reference ?? "",
            concept: endorsement.concept ?? "",
            notes: endorsement.notes ?? "",
          })}
          policySummary={
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {endorsement.policy.policyNumber} · {endorsement.policy.client.fullName}
              </p>
              <p className="text-muted-foreground">{endorsement.policy.insurer.name}</p>
              <p className="text-xs text-muted-foreground">
                Vigencia del endoso: {formatDate(endorsement.startDate)} · {formatDate(endorsement.endDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                <Link href={`/policies/${policy.id}`} className="text-primary hover:underline">
                  Volver a la póliza base
                </Link>
              </p>
            </div>
          }
          submitAction={updateEndorsement.bind(null, endorsement.id)}
        />
      </div>
    </div>
  );
}
