"use client";

import { toast } from "sonner";
import { cancelReceipt } from "@/app/(dashboard)/receipts/actions";
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
    const result = await cancelReceipt(id);
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
          Esta acción solo está disponible cuando la póliza ya fue cancelada y el recibo no tiene pagos.
          El recibo dejará de aparecer en cobranza y vencimientos.
        </>
      }
      confirmLabel="Cancelar recibo"
      cancelLabel="Cerrar"
      destructive
      onConfirm={handleConfirm}
      triggerLabel={triggerLabel}
      triggerClassName={triggerClassName}
    />
  );
}
