import { createReceipt } from "@/app/(dashboard)/receipts/actions";
import { ReceiptForm } from "@/components/forms/receipt-form";
import { createReceiptDefaults } from "@/lib/form-defaults";
import { PageHeader } from "@/components/layout/page-header";
import { getDb } from "@/lib/db";

export default async function NewReceiptPage() {
  const db = getDb();
  const policies = await db.policy.findMany({
    where: { status: { not: "CANCELLED" } },
    include: { client: true },
    orderBy: { policyNumber: "asc" },
  });

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
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
          defaultValues={createReceiptDefaults()}
          policyOptions={policies.map((policy) => ({
            value: policy.id,
            label: `${policy.policyNumber} · ${policy.client.fullName}`,
          }))}
          submitAction={createReceipt}
        />
      </div>
    </main>
  );
}