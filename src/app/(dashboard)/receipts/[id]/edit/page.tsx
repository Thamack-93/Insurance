import { notFound } from "next/navigation";
import { updateReceipt } from "@/app/(dashboard)/receipts/actions";
import { ReceiptForm } from "@/components/forms/receipt-form";
import { createReceiptDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";
import { formatDateInput } from "@/lib/form-utils";

export default async function EditReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [receipt, policies] = await Promise.all([
    db.receipt.findUnique({ where: { id } }),
    db.policy.findMany({
      where: { status: { not: "CANCELLED" } },
      include: { client: true },
      orderBy: { policyNumber: "asc" },
    }),
  ]);

  if (!receipt) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title={`Editar ${receipt.receiptNumber}`}
          description="Actualiza periodos y vencimiento sin mezclar el recibo con el evento de pago."
        />

        <ReceiptForm
          title="Edición de recibo"
          description="Los cambios actualizan vistas de cobranza, cartera y riesgo."
          submitLabel="Guardar cambios"
          cancelHref="/receipts"
          defaultValues={createReceiptDefaults({
            receiptNumber: receipt.receiptNumber,
            policyId: receipt.policyId,
            periodStartDate: formatDateInput(receipt.periodStartDate),
            periodEndDate: formatDateInput(receipt.periodEndDate),
            dueDate: formatDateInput(receipt.dueDate),
            amount: Number(receipt.amount),
            currency: receipt.currency,
            status: receipt.status,
            notes: receipt.notes ?? "",
          })}
          policyOptions={policies.map((policy) => ({
            value: policy.id,
            label: `${policy.policyNumber} · ${policy.client.fullName}`,
          }))}
          submitAction={updateReceipt.bind(null, receipt.id)}
        />
      </div>
    </main>
  );
}