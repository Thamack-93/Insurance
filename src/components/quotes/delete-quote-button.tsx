"use client";

import { deleteQuote } from "@/app/(dashboard)/quotes/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteQuoteButtonProps = {
  id: string;
  label: string;
};

export function DeleteQuoteButton({ id, label }: DeleteQuoteButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="cotización"
      itemName={label}
      fallbackRedirect="/quotes"
      onDelete={deleteQuote}
      description={
        <>
          ¿Seguro que quieres eliminar la cotización <strong>{label}</strong>? Esta acción no se puede
          deshacer y no funciona si la cotización ya fue aceptada.
        </>
      }
    />
  );
}
