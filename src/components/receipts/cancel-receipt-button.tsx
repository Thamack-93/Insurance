"use client";

import { toast } from "sonner";
import { cancelReceipt, cancelReceiptAndPolicy } from "@/app/(dashboard)/receipts/actions";
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
          Esta acción permite cancelar manualmente por falta de pago aun antes de 65 días.
          Se cancelarán también los recibos abiertos de la póliza y quedarán disponibles para rehabilitación.
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

export function CancelReceiptOnlyButton({
  id,
  receiptNumber,
  triggerLabel = "Cancelar solo este recibo",
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
      title={`Cancelar solo el recibo ${receiptNumber}`}
      description={
        <>
          Esta acción cancela únicamente el recibo actual. No cambia el estado de la póliza ni de otros recibos.
          Si este recibo tiene pagos registrados, elimínalos primero desde su detalle.
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
