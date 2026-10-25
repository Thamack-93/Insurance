import { notFound } from "next/navigation";
import { updateReceipt } from "@/app/(dashboard)/receipts/actions";
import { ReceiptForm } from "@/components/forms/receipt-form";
import { createReceiptDefaults, readReceiptPremiumUnits } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { CancelReceiptOnlyButton } from "@/components/receipts/cancel-receipt-button";
import { withTenantTransaction } from "@/lib/organization-context";
import { formatDateInput } from "@/lib/form-utils";
import type { ReceiptFormValues } from "@/lib/validations";
import { getPolicyOptionLabel } from "@/lib/policy-identity";
import { endorsementOperationalWhere, policyOperationalWhere, receiptOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

export default async function EditReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOrganizationPortfolioReadScope();
  const { receipt, policies, endorsements } = await withTenantTransaction(scope.context, async (db) => {
    const receipt = await db.receipt.findFirst({
      where: { id, ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
      include: {
        client: true,
        policy: { include: { insuredAssets: { select: { id: true, description: true, unitClass: true, isPrimary: true } } } },
        insurer: true,
        endorsement: {
          include: {
            policy: {
              include: {
                client: true,
                insuredAssets: { select: { id: true, description: true, unitClass: true, isPrimary: true } },
              },
            },
          },
        },
      },
    });
    if (!receipt) return { receipt: null, policies: [], endorsements: [] };
    const policies = receipt.endorsement
      ? [{
          id: receipt.policyId,
          policyNumber: receipt.policy.policyNumber,
          insuredObject: receipt.policy.insuredObject,
          insuredAssets: receipt.policy.insuredAssets,
          currency: receipt.policy.currency,
          client: { fullName: receipt.client.fullName },
        }]
      : await db.policy.findMany({
          where: { status: { not: "CANCELLED" }, ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) },
          include: { client: true, insuredAssets: { select: { id: true, description: true, unitClass: true, isPrimary: true } } },
          orderBy: { policyNumber: "asc" },
        });
    const endorsements = await db.policyEndorsement.findMany({
      where: {
        policyId: receipt.policyId,
        ...endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
      },
      select: { id: true, endorsementNumber: true, reference: true },
      orderBy: { endorsementNumber: "asc" },
    });
    return { receipt, policies, endorsements };
  });

  if (!receipt) {
    notFound();
  }

  const endorsementOptions = endorsements.map((endorsement) => ({
    value: endorsement.id,
    label: `${endorsement.endorsementNumber} · ${endorsement.reference ?? "Sin referencia"}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title={`Editar ${receipt.receiptNumber}`}
          description="Actualiza periodos, cobro manual y vencimiento sin mezclar el recibo con el evento de pago."
        />

        <ReceiptForm
          title="Edición de recibo"
          description="Los cambios actualizan vistas de cobranza, cartera y riesgo. La fecha y el método de pago se ajustan manualmente en este formulario."
          submitLabel="Guardar cambios"
          cancelHref="/receipts"
          defaultValues={createReceiptDefaults({
            receiptNumber: receipt.receiptNumber,
            policyId: receipt.policyId,
            periodStartDate: formatDateInput(receipt.periodStartDate),
            periodEndDate: formatDateInput(receipt.periodEndDate),
            dueDate: formatDateInput(receipt.dueDate),
            endorsementId: receipt.endorsementId ?? "",
            amount: Number(receipt.amount),
            currency: receipt.currency,
            status: receipt.status as ReceiptFormValues["status"],
            paidDate: formatDateInput(receipt.paidDate),
            paymentMethod: receipt.paymentMethod ?? "",
            notes: receipt.notes ?? "",
            vatAmount: receipt.vatAmount == null ? "" : Number(receipt.vatAmount),
            issuanceExpenseAmount: receipt.issuanceExpenseAmount == null ? "" : Number(receipt.issuanceExpenseAmount),
            surchargeAmount: receipt.surchargeAmount == null ? "" : Number(receipt.surchargeAmount),
            discountAmount: receipt.discountAmount == null ? "" : Number(receipt.discountAmount),
            premiumBreakdownByUnit: readReceiptPremiumUnits(receipt.premiumBreakdownByUnit),
          })}
          policyOptions={policies.map((policy) => ({
            value: policy.id,
            label: getPolicyOptionLabel(policy, [policy.client.fullName]),
          }))}
          policyAssets={Object.fromEntries(policies.map((policy) => [policy.id, policy.insuredAssets]))}
          endorsementOptions={endorsementOptions}
          submitAction={updateReceipt.bind(null, receipt.id)}
          footerActions={
            <CancelReceiptOnlyButton
              id={receipt.id}
              receiptNumber={receipt.receiptNumber}
              triggerClassName="border-destructive/40 bg-card/80 text-destructive hover:bg-destructive/10 hover:text-destructive"
            />
          }
        />
      </div>
    </div>
  );
}
