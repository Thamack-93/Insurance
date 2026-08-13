"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/drawers/confirm-dialog";
import type { MutationResult } from "@/lib/mutation-utils";
import { useBulkActions } from "./bulk-actions-provider";

export type BulkAction = {
  key: string;
  label: string;
  /** Question shown in the confirmation dialog. */
  confirmTitle: (count: number) => string;
  confirmDescription: (count: number) => string;
  confirmLabel?: string;
  destructive?: boolean;
  run: (ids: string[]) => Promise<MutationResult>;
};

export type BulkActionsToolbarProps = {
  /** Ids selectable on the current page. */
  allIds: string[];
  /** Singular and plural noun, e.g. `["póliza", "pólizas"]`. */
  noun: [string, string];
  actions: BulkAction[];
  /** Grammatical gender of the noun, used for "seleccionada/o". */
  gender?: "f" | "m";
};

/**
 * Selection bar shared by the list screens: it owns the select-all checkbox,
 * the running count, and every bulk action — each one behind a confirmation
 * dialog, and each one reporting back the server's summary of what happened
 * (updated, unchanged, skipped, out of scope) rather than a bare "listo".
 */
export function BulkActionsToolbar({ allIds, noun, actions, gender = "m" }: BulkActionsToolbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openAction, setOpenAction] = useState<string | null>(null);
  const { selectedItems, hasSelection, clearSelection, getSelectedIds, selectAll } = useBulkActions();

  if (allIds.length === 0) return null;

  const selectedCount = selectedItems.size;
  const allSelected = selectedCount > 0 && allIds.every((id) => selectedItems.has(id));
  const selectedWord = gender === "f" ? "seleccionada" : "seleccionado";

  function runAction(action: BulkAction) {
    const ids = getSelectedIds();

    if (ids.length === 0) {
      toast.error(`Selecciona al menos ${gender === "f" ? "una" : "un"} ${noun[0]}.`);
      return;
    }

    startTransition(async () => {
      const result = await action.run(ids);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // The server action returns a per-record breakdown; surface it verbatim.
      toast.success(result.message ?? "Acción aplicada.");
      clearSelection();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2">
      <Checkbox
        checked={allSelected}
        onCheckedChange={(checked) => (checked ? selectAll(allIds) : clearSelection())}
        aria-label={`Seleccionar ${gender === "f" ? "todas las" : "todos los"} ${noun[1]} de la página`}
      />
      {hasSelection ? (
        <>
          <span aria-live="polite" className="text-sm text-muted-foreground">
            {selectedCount} {selectedCount === 1 ? noun[0] : noun[1]} {selectedWord}
            {selectedCount === 1 ? "" : "s"}
          </span>
          {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          {actions.map((action) => (
            <ConfirmDialog
              key={action.key}
              open={openAction === action.key}
              onOpenChange={(next) => setOpenAction(next ? action.key : null)}
              title={action.confirmTitle(selectedCount)}
              description={action.confirmDescription(selectedCount)}
              confirmLabel={action.confirmLabel ?? action.label}
              destructive={action.destructive}
              onConfirm={() => runAction(action)}
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpenAction(action.key)}
              >
                {action.label}
              </Button>
            </ConfirmDialog>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={clearSelection} disabled={isPending}>
            Limpiar selección
          </Button>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">
          {gender === "f" ? "Selecciona" : "Selecciona"} {noun[1]} para aplicar una acción en lote
        </span>
      )}
    </div>
  );
}
