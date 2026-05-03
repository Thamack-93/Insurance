import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { PaymentForm } from "@/components/forms/payment-form";
import { createPayment, getPendingReceipts } from "../actions";

export default async function NewPaymentPage() {
  const receipts = await getPendingReceipts();

  const formReceipts = receipts.map((receipt) => ({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    amount: receipt.amount,
    currency: receipt.currency,
    client: { fullName: receipt.client.fullName },
    policy: { policyNumber: receipt.policy.policyNumber },
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Registrar pago"
          description="Selecciona un recibo pendiente y registra su pago."
          actions={
            <Button asChild variant="outline" className="rounded-full bg-card/70">
              <Link href="/receipts">
                <ArrowLeft className="mr-2 size-4" />
                Volver a recibos
              </Link>
            </Button>
          }
        />

        <PaymentForm
          receipts={formReceipts}
          submitAction={createPayment}
          cancelHref="/receipts"
        />
      </div>
    </div>
  );
}
