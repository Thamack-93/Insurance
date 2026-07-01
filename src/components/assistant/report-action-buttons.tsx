"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MutationResult } from "@/lib/mutation-utils";

type ReportAction = (id: string) => Promise<MutationResult>;

type AssistantReportActionButtonsProps = {
  id: string;
  closeAction?: ReportAction;
  archiveAction?: ReportAction;
  reopenAction?: ReportAction;
  deleteAction?: ReportAction;
};

export function AssistantReportActionButtons({
  id,
  closeAction,
  archiveAction,
  reopenAction,
  deleteAction,
}: AssistantReportActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: ReportAction, successMessage: string) {
    startTransition(async () => {
      const result = await action(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message ?? successMessage);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {closeAction ? (
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={isPending} onClick={() => run(closeAction, "Cerrado.")}>
          Cerrar
        </Button>
      ) : null}
      {archiveAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={isPending}
          onClick={() => run(archiveAction, "Archivado.")}
        >
          Archivar
        </Button>
      ) : null}
      {reopenAction ? (
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={isPending} onClick={() => run(reopenAction, "Reabierto.")}>
          Reabrir
        </Button>
      ) : null}
      {deleteAction ? (
        <Button type="button" size="sm" variant="destructive" className="rounded-full" disabled={isPending} onClick={() => run(deleteAction, "Eliminado.")}>
          Eliminar
        </Button>
      ) : null}
    </div>
  );
}
