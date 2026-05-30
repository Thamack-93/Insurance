"use client";

import { deleteWorkItem } from "@/app/(dashboard)/tasks/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteWorkItemButtonProps = {
  id: string;
  folio: string;
};

export function DeleteWorkItemButton({ id, folio }: DeleteWorkItemButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="pendiente"
      itemName={folio}
      fallbackRedirect="/tasks"
      onDelete={deleteWorkItem}
      description={
        <>
          ¿Seguro que quieres eliminar el pendiente <strong>{folio}</strong>? Esta acción no se puede
          deshacer.
        </>
      }
    />
  );
}
