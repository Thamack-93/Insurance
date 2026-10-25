import { createReceipt } from "@/app/(dashboard)/receipts/actions";
import { ReceiptForm } from "@/components/forms/receipt-form";
import { createReceiptDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { withTenantTransaction } from "@/lib/organization-context";
import { formatDate } from "@/lib/dates";
import { formatDateInput } from "@/lib/form-utils";
import { getPolicyOptionLabel } from "@/lib/policy-identity";
import type { SelectOption } from "@/lib/domain-options";
import {
  endorsementOperationalWhere,
  policyOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams?: Promise<{ policyId?: string; endorsementId?: string }>;
}) {
  const scope = await requireOrganizationPortfolioReadScope();
  const params = (await searchParams) ?? {};
  const policyId = params.policyId?.trim() || "";
  const endorsementId = params.endorsementId?.trim() || "";

  const [policies, selectedPolicy, selectedEndorsement] = await withTenantTransaction(scope.context, (db) => Promise.all([
    db.policy.findMany({
      where: { status: { not: "CANCELLED" }, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: {
        client: true,
        insuredAssets: { select: { id: true, description: true, unitClass: true, isPrimary: true } },
      },
      orderBy: { policyNumber: "asc" },
    }),
    policyId
      ? db.policy.findFirst({
          where: { id: policyId, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
          include: {
            client: true,
            insuredAssets: { select: { id: true, description: true, unitClass: true, isPrimary: true } },
          },
        })
      : Promise.resolve(null),
    endorsementId
      ? db.policyEndorsement.findFirst({
          where: { id: endorsementId, ...endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
          include: {
            policy: {
              include: {
                client: true,
                insuredAssets: { select: { description: true, isPrimary: true } },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]));

  const contextPolicy = selectedEndorsement?.policy ?? selectedPolicy;
  const policyOptions = contextPolicy
    ? [
        {
          value: contextPolicy.id,
          label: getPolicyOptionLabel(contextPolicy, [contextPolicy.client.fullName]),
        },
      ]
    : policies.map((policy) => ({
        value: policy.id,
        label: getPolicyOptionLabel(policy, [policy.client.fullName]),
      }));
  const endorsementPolicyIds = Array.from(new Set(policyOptions.map((option) => option.value)));
  const endorsements = await withTenantTransaction(scope.context, (db) => db.policyEndorsement.findMany({
    where: {
      policyId: { in: endorsementPolicyIds },
      ...endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
    },
    select: { id: true, policyId: true, endorsementNumber: true, reference: true },
    orderBy: { endorsementNumber: "asc" },
  }));
  const endorsementOptionsByPolicy = endorsements.reduce<Record<string, SelectOption[]>>((optionsByPolicy, endorsement) => {
    const options = optionsByPolicy[endorsement.policyId] ?? [];
    options.push({
      value: endorsement.id,
      label: `${endorsement.endorsementNumber} · ${endorsement.reference ?? "Sin referencia"}`,
    });
    optionsByPolicy[endorsement.policyId] = options;
    return optionsByPolicy;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Nuevo recibo"
          description="Registra una obligación financiera separada del evento real de pago."
        />

        <ReceiptForm
          title="Alta de recibo"
          description="El recibo alimenta cobranza, vencimientos y riesgos."
          submitLabel="Crear recibo"
          cancelHref="/receipts"
          defaultValues={createReceiptDefaults({
            policyId: contextPolicy?.id ?? policyId,
            endorsementId: selectedEndorsement?.id ?? endorsementId,
            currency: contextPolicy?.currency ?? "MXN",
            periodStartDate: selectedEndorsement ? formatDateInput(selectedEndorsement.startDate) : undefined,
            periodEndDate: selectedEndorsement ? formatDateInput(selectedEndorsement.endDate) : undefined,
          })}
          policyOptions={policyOptions}
          policyAssets={Object.fromEntries(policies.map((policy) => [policy.id, policy.insuredAssets]))}
          endorsementOptionsByPolicy={endorsementOptionsByPolicy}
          submitAction={createReceipt}
          footerActions={
            selectedEndorsement && selectedEndorsement.policy ? (
              <div className="text-sm text-muted-foreground">
                Endoso vinculado: {selectedEndorsement.endorsementNumber} · {selectedEndorsement.policy.policyNumber}
                {" "}
                · {formatDate(selectedEndorsement.startDate)} a {formatDate(selectedEndorsement.endDate)}
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
}
