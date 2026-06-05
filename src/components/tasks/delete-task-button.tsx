"use client";

import { deleteWorkItem } from "@/app/(dashboard)/tasks/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteWorkItemButtonProps = {
  id: string;
  folio: string;
  triggerClassName?: string;
  triggerLabel?: string;
};

export function DeleteWorkItemButton({ id, folio, triggerClassName, triggerLabel }: DeleteWorkItemButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="pendiente"
      itemName={folio}
      fallbackRedirect="/tasks"
      onDelete={deleteWorkItem}
      triggerClassName={triggerClassName}
      triggerLabel={triggerLabel}
      description={
        <>
          ¿Seguro que quieres eliminar el pendiente <strong>{folio}</strong>? Esta acción no se puede
          deshacer.
        </>
      }
    />
  );
}
