"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteInsurer } from "@/app/(dashboard)/insurers/actions";

type DeleteInsurerButtonProps = {
  id: string;
  name: string;
};

export function DeleteInsurerButton({ id, name }: DeleteInsurerButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteInsurer(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setIsOpen(false);
      router.push(result.redirectTo || "/insurers");
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="rounded-full bg-card/70 text-destructive hover:text-destructive" />
        }
      >
        <Trash2 className="mr-2 size-4" />
        Eliminar
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminar aseguradora</DialogTitle>
          <DialogDescription>
            ¿Seguro que quieres eliminar <strong>{name}</strong>? Esta acción no se puede deshacer y solo
            funciona si la aseguradora no tiene pólizas, recibos, comisiones, siniestros ni cotizaciones
            asociadas.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "Eliminando..." : "Eliminar definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
