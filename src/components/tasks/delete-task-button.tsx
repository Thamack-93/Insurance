"use client";

import { deleteTask } from "@/app/(dashboard)/tasks/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteTaskButtonProps = {
  id: string;
  folio: string;
};

export function DeleteTaskButton({ id, folio }: DeleteTaskButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="pendiente"
      itemName={folio}
      fallbackRedirect="/tasks"
      onDelete={deleteTask}
      description={
        <>
          ¿Seguro que quieres eliminar el pendiente <strong>{folio}</strong>? Esta acción no se puede
          deshacer.
        </>
      }
    />
  );
}
