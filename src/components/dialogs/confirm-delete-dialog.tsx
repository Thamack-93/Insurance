"use client";

import { useState, useTransition, type ReactNode } from "react";
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
import type { MutationResult } from "@/lib/mutation-utils";

type ConfirmDeleteDialogProps = {
  entityLabel: string;
  itemName: string;
  description: ReactNode;
  onDelete: (id: string) => Promise<MutationResult>;
  id: string;
  fallbackRedirect?: string;
};

export function ConfirmDeleteDialog({
  entityLabel,
  itemName,
  description,
  onDelete,
  id,
  fallbackRedirect = "/",
}: ConfirmDeleteDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      const result = await onDelete(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setIsOpen(false);
      router.push(result.redirectTo || fallbackRedirect);
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
          <DialogTitle>Eliminar {entityLabel}</DialogTitle>
          <DialogDescription>
            {description ?? (
              <>
                ¿Seguro que quieres eliminar <strong>{itemName}</strong>? Esta acción no se puede deshacer.
              </>
            )}
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
