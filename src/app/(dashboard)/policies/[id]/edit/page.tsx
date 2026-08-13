import { notFound } from "next/navigation";
import { updatePolicy } from "@/app/(dashboard)/policies/actions";
import { PolicyForm } from "@/components/forms/policy-form";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";
import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import type { PolicyFormValues } from "@/lib/validations";
import { clientOperationalWhere, policyOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const isAdmin = scope.membershipRole !== "AGENT";
  const db = getDb();
  const [policy, clients, insurers] = await Promise.all([
    db.policy.findFirst({
      where: { id, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: {
        renewedFrom: {
          select: {
            id: true,
            policyNumber: true,
            clientId: true,
            insurerId: true,
            policyType: true,
            startDate: true,
            endDate: true,
            premiumAmount: true,
            currency: true,
            paymentFrequency: true,
            paymentPlan: true,
            insuredObject: true,
            beneficiaryInfo: true,
            notes: true,
            client: { select: { fullName: true } },
            insurer: { select: { name: true } },
          },
        },
      },
    }),
    db.client.findMany({
      where: { status: { not: "ARCHIVED" }, ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    db.insurer.findMany({
      where: { status: { not: "ARCHIVED" }, organizationId: scope.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!policy) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title={`Editar ${policy.policyNumber}`}
          description="Ajusta vigencia, prima o relaciones de la póliza con trazabilidad."
        />

        <PolicyForm
          title="Edición de póliza"
          description="Los cambios impactan cartera, renovaciones y pantallas financieras relacionadas."
          submitLabel="Guardar cambios"
          cancelHref={`/policies/${policy.id}`}
          defaultValues={createPolicyDefaults({
            policyNumber: policy.policyNumber,
            clientId: policy.clientId,
            insurerId: policy.insurerId,
            policyType: policy.policyType as PolicyFormValues["policyType"],
            status: policy.status as PolicyFormValues["status"],
            startDate: formatDateInput(policy.startDate),
            endDate: formatDateInput(policy.endDate),
            premiumAmount: Number(policy.premiumAmount),
            currency: policy.currency,
            paymentFrequency: policy.paymentFrequency as PolicyFormValues["paymentFrequency"],
            paymentPlan: policy.paymentPlan ?? "",
            insuredObject: policy.insuredObject ?? "",
            beneficiaryInfo: policy.beneficiaryInfo ?? "",
            notes: policy.notes ?? "",
            renewedFromPolicyId: policy.renewedFromPolicyId ?? "",
          })}
          clientOptions={clients.map((client) => ({ value: client.id, label: client.fullName }))}
          insurerOptions={insurers.map((insurer) => ({ value: insurer.id, label: insurer.name }))}
          renewalSource={
            policy.renewedFrom
              ? {
                  id: policy.renewedFrom.id,
                  policyNumber: policy.renewedFrom.policyNumber,
                  clientId: policy.renewedFrom.clientId,
                  clientName: policy.renewedFrom.client.fullName,
                  insurerId: policy.renewedFrom.insurerId,
                  insurerName: policy.renewedFrom.insurer.name,
                  policyType: policy.renewedFrom.policyType as PolicyRenewalSource["policyType"],
                  startDate: policy.renewedFrom.startDate,
                  endDate: policy.renewedFrom.endDate,
                  premiumAmount: Number(policy.renewedFrom.premiumAmount),
                  currency: policy.renewedFrom.currency as PolicyRenewalSource["currency"],
                  paymentFrequency: policy.renewedFrom.paymentFrequency as PolicyRenewalSource["paymentFrequency"],
                  paymentPlan: policy.renewedFrom.paymentPlan,
                  insuredObject: policy.renewedFrom.insuredObject,
                  beneficiaryInfo: policy.renewedFrom.beneficiaryInfo,
                  notes: policy.renewedFrom.notes,
                }
              : null
          }
          showRenewalLink={isAdmin}
          submitAction={updatePolicy.bind(null, policy.id)}
        />
      </div>
    </div>
  );
}
