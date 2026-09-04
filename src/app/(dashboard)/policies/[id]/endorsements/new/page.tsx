import Link from "next/link";
import { notFound } from "next/navigation";
import { createEndorsement } from "@/app/(dashboard)/policies/endorsements/actions";
import { EndorsementForm } from "@/components/forms/endorsement-form";
import { createEndorsementDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantTransaction } from "@/lib/organization-context";
import { formatDate } from "@/lib/dates";
import { formatDateInput } from "@/lib/form-utils";
import { policyOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function NewEndorsementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const policy = await withTenantTransaction(scope.context, (db) => db.policy.findFirst({
    where: { id, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
    include: { client: true, insurer: true },
  }));

  if (!policy) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Póliza"
          title="Nuevo endoso"
          description="Registra un ajuste ligado a la póliza base y conserva sus recibos separados."
        />

        <EndorsementForm
          title="Alta de endoso"
          description="El endoso queda anclado a esta póliza y después puede tener uno o varios recibos."
          submitLabel="Crear endoso"
          cancelHref={`/policies/${policy.id}`}
          defaultValues={createEndorsementDefaults({
            policyId: policy.id,
            endDate: formatDateInput(policy.endDate),
            currency: policy.currency,
          })}
          policySummary={
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                {policy.policyNumber} · {policy.client.fullName}
              </p>
              <p className="text-muted-foreground">{policy.insurer.name}</p>
              <p className="text-xs text-muted-foreground">
                Vigencia base: {formatDate(policy.startDate)} · {formatDate(policy.endDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                <Link href={`/policies/${policy.id}`} className="text-primary hover:underline">
                  Volver a la póliza base
                </Link>
              </p>
            </div>
          }
          submitAction={createEndorsement}
        />
      </div>
    </div>
  );
}
