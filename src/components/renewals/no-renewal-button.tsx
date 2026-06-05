"use client";

import { toast } from "sonner";
import { markRenewalAsNotContinuing } from "@/app/(dashboard)/renewals/actions";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";

type NoRenewalButtonProps = {
  policyId: string;
  policyNumber: string;
  triggerClassName?: string;
  triggerLabel?: string;
};

export function NoRenewalButton({
  policyId,
  policyNumber,
  triggerClassName,
  triggerLabel = "No renueva",
}: NoRenewalButtonProps) {
  const handleConfirm = async () => {
    const result = await markRenewalAsNotContinuing(policyId);
    if (!result.ok) {
      toast.error(result.error);
    } else {
      toast.success(result.message);
    }
  };

  return (
    <ConfirmDialog
      title={`Cerrar renovación de ${policyNumber}`}
      description={
        <>
          Marca esta renovación como no continuada. Se cerrará el pendiente relacionado y quedará la nota
          histórica, sin cambiar el estado de la póliza.
        </>
      }
      confirmLabel="Cerrar renovación"
      cancelLabel="Cancelar"
      onConfirm={handleConfirm}
      triggerLabel={triggerLabel}
      triggerClassName={triggerClassName}
    />
  );
}
