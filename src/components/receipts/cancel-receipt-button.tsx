"use client";

import { toast } from "sonner";
import { cancelReceiptAndPolicy } from "@/app/(dashboard)/receipts/actions";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";

type CancelReceiptButtonProps = {
  id: string;
  receiptNumber: string;
  triggerLabel?: string;
  triggerClassName?: string;
};

export function CancelReceiptButton({
  id,
  receiptNumber,
  triggerLabel = "Cancelar",
  triggerClassName,
}: CancelReceiptButtonProps) {
  const handleConfirm = async () => {
    const result = await cancelReceiptAndPolicy(id);
    if (!result.ok) {
      toast.error(result.error);
    } else {
      toast.success(result.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Cancelar recibo ${receiptNumber}`}
      description={
        <>
          Si el cliente no pagó, esta acción cancela el recibo, la póliza y cualquier otro recibo abierto de esa póliza.
          Los recibos ya pagados no se tocan.
        </>
      }
      confirmLabel="Cancelar"
      cancelLabel="Cerrar"
      destructive
      onConfirm={handleConfirm}
      triggerLabel={triggerLabel}
      triggerClassName={triggerClassName}
    />
  );
}
