"use client";

import { deletePayment } from "@/app/(dashboard)/payments/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { paymentMethodLabel } from "@/lib/ui-labels";

type DeletePaymentButtonProps = {
  id: string;
  receiptId: string;
  receiptNumber: string;
  paidDate: string | Date;
  amount: number;
  currency: string;
  paymentMethod?: string | null;
  triggerLabel?: string;
  triggerClassName?: string;
};

export function DeletePaymentButton({
  id,
  receiptId,
  receiptNumber,
  paidDate,
  amount,
  currency,
  paymentMethod,
  triggerLabel = "Eliminar",
  triggerClassName,
}: DeletePaymentButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="pago"
      itemName={`${formatCurrency(amount, currency)} · recibo ${receiptNumber}`}
      fallbackRedirect={`/receipts/${receiptId}`}
      onDelete={deletePayment}
      triggerLabel={triggerLabel}
      triggerClassName={triggerClassName}
      description={
        <>
          ¿Seguro que quieres revertir el pago de <strong>{formatCurrency(amount, currency)}</strong>{" "}
          registrado el <strong>{formatDate(paidDate)}</strong>
          {paymentMethod ? <> con método <strong>{paymentMethodLabel(paymentMethod)}</strong></> : null}? El pago se conservará en la auditoría
          y el recibo se volverá a conciliar.
        </>
      }
    />
  );
}
