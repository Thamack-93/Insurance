"use client";

import { deletePayment } from "@/app/(dashboard)/payments/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";
import { formatCurrency } from "@/lib/money";
import { formatCalendarDate } from "@/lib/calendar-dates";

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
          ¿Seguro que quieres eliminar el pago de <strong>{formatCurrency(amount, currency)}</strong>{" "}
          registrado el <strong>{formatCalendarDate(paidDate)}</strong>
          {paymentMethod ? <> con método <strong>{paymentMethod}</strong></> : null}? Esta acción recalcula el recibo
          y, si era el último obstáculo, te permitirá cancelar la póliza después.
        </>
      }
    />
  );
}
