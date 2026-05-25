"use client";

import { deletePolicy } from "@/app/(dashboard)/policies/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeletePolicyButtonProps = {
  id: string;
  policyNumber: string;
};

export function DeletePolicyButton({ id, policyNumber }: DeletePolicyButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="póliza"
      itemName={policyNumber}
      fallbackRedirect="/policies"
      onDelete={deletePolicy}
      description={
        <>
          ¿Seguro que quieres eliminar la póliza <strong>{policyNumber}</strong>? Esta acción no se puede
          deshacer y solo funciona si la póliza no tiene recibos, pagos, comisiones ni siniestros asociados.
        </>
      }
    />
  );
}
