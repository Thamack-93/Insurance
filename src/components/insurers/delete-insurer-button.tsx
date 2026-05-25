"use client";

import { deleteInsurer } from "@/app/(dashboard)/insurers/actions";
import { ConfirmDeleteDialog } from "@/components/dialogs/confirm-delete-dialog";

type DeleteInsurerButtonProps = {
  id: string;
  name: string;
};

export function DeleteInsurerButton({ id, name }: DeleteInsurerButtonProps) {
  return (
    <ConfirmDeleteDialog
      id={id}
      entityLabel="aseguradora"
      itemName={name}
      fallbackRedirect="/insurers"
      onDelete={deleteInsurer}
      description={
        <>
          ¿Seguro que quieres eliminar <strong>{name}</strong>? Esta acción no se puede deshacer y solo
          funciona si la aseguradora no tiene pólizas, recibos, comisiones, siniestros ni cotizaciones
          asociadas.
        </>
      }
    />
  );
}
