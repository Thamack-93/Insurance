import { createReceipt } from "@/app/(dashboard)/receipts/actions";
import { ReceiptForm } from "@/components/forms/receipt-form";
import { createReceiptDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatDateInput } from "@/lib/form-utils";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams?: Promise<{ policyId?: string; endorsementId?: string }>;
}) {
  const db = getDb();
  const params = (await searchParams) ?? {};
  const policyId = params.policyId?.trim() || "";
  const endorsementId = params.endorsementId?.trim() || "";

  const [policies, selectedPolicy, selectedEndorsement] = await Promise.all([
    db.policy.findMany({
      where: { status: { not: "CANCELLED" } },
      include: { client: true },
      orderBy: { policyNumber: "asc" },
    }),
    policyId
      ? db.policy.findUnique({
          where: { id: policyId },
          include: { client: true },
        })
      : Promise.resolve(null),
    endorsementId
      ? db.policyEndorsement.findUnique({
          where: { id: endorsementId },
          include: {
            policy: {
              include: { client: true },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const contextPolicy = selectedEndorsement?.policy ?? selectedPolicy;
  const policyOptions = contextPolicy
    ? [
        {
          value: contextPolicy.id,
          label: `${contextPolicy.policyNumber} · ${contextPolicy.client.fullName}`,
        },
      ]
    : policies.map((policy) => ({
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.client.fullName}`,
      }));
  const endorsementOptions =
    selectedEndorsement && selectedEndorsement.policyId === contextPolicy?.id
      ? [
          {
            value: selectedEndorsement.id,
            label: `${selectedEndorsement.endorsementNumber} · ${selectedEndorsement.reference ?? "Sin referencia"}`,
          },
        ]
      : undefined;

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
          endorsementOptions={endorsementOptions}
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
