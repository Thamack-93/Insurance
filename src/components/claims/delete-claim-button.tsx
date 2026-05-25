"use client";

import { deleteClaim } from "@/app/(dashboard)/claims/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteClaimButtonProps = {
  id: string;
  folio: string;
};

export function DeleteClaimButton({ id, folio }: DeleteClaimButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="siniestro"
      itemName={folio}
      fallbackRedirect="/claims"
      onDelete={deleteClaim}
      description={
        <>
          ¿Seguro que quieres eliminar el siniestro <strong>{folio}</strong>? Esta acción no se puede
          deshacer y solo funciona si el siniestro no está en proceso ni esperando aseguradora.
        </>
      }
    />
  );
}
