"use client";

import { deleteClient } from "@/app/(dashboard)/clients/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteClientButtonProps = {
  id: string;
  name: string;
};

export function DeleteClientButton({ id, name }: DeleteClientButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="cliente"
      itemName={name}
      fallbackRedirect="/clients"
      onDelete={deleteClient}
      description={
        <>
          ¿Seguro que quieres eliminar <strong>{name}</strong>? Esta acción no se puede deshacer y solo
          funciona si el cliente no tiene pólizas, recibos, pagos, comisiones, siniestros ni cotizaciones
          asociadas.
        </>
      }
    />
  );
}
