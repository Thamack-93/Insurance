"use client";

import { deleteReceipt } from "@/app/(dashboard)/receipts/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteReceiptButtonProps = {
  id: string;
  receiptNumber: string;
};

export function DeleteReceiptButton({ id, receiptNumber }: DeleteReceiptButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="recibo"
      itemName={receiptNumber}
      fallbackRedirect="/receipts"
      onDelete={deleteReceipt}
      description={
        <>
          ¿Seguro que quieres eliminar el recibo <strong>{receiptNumber}</strong>? Esta acción no se puede
          deshacer y solo funciona si el recibo no tiene pagos ni comisiones asociadas.
        </>
      }
    />
  );
}
