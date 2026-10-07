"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GripVertical } from "lucide-react";
import { setRenewalStage } from "@/app/(dashboard)/renewals/actions";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { renewalStageLabel } from "@/lib/status";
import type { RenewalStage } from "@/lib/renewal-board.logic";
import { cn } from "@/lib/utils";

const DRAG_POLICY_TYPE = "application/x-policydesk-renewal-policy";

type DraggedRenewal = { policyId: string; policyNumber: string; stage: RenewalStage };

export function DraggableRenewalCard({
  policyId,
  policyNumber,
  stage,
  children,
}: DraggedRenewal & { children: ReactNode }) {
  const canDrag = stage !== "WON" && stage !== "LOST";

  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_POLICY_TYPE, JSON.stringify({ policyId, policyNumber, stage }));
    event.dataTransfer.setData("text/plain", policyNumber);
  }

  return (
    <li
      className="relative rounded-xl"
    >
      {canDrag ? (
        <span
          data-renewal-drag-handle
          draggable={canDrag}
          onDragStart={canDrag ? handleDragStart : undefined}
          title="Arrastra esta tarjeta a otra etapa"
          aria-hidden="true"
          className="absolute left-2 top-2 z-10 inline-flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
      ) : null}
      {children}
    </li>
  );
}

export function RenewalDropColumn({
  stage,
  count,
  children,
}: {
  stage: RenewalStage;
  count: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [confirmation, setConfirmation] = useState<DraggedRenewal | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const acceptsDrop = stage !== "WON";

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!acceptsDrop || !Array.from(event.dataTransfer.types).includes(DRAG_POLICY_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!acceptsDrop) return;

    const raw = event.dataTransfer.getData(DRAG_POLICY_TYPE);
    if (!raw) return;

    try {
      const dragged = JSON.parse(raw) as DraggedRenewal;
      if (!dragged.policyId || dragged.stage === stage || dragged.stage === "WON" || dragged.stage === "LOST") return;
      if (stage === "LOST") {
        setConfirmation(dragged);
        return;
      }
      startTransition(async () => {
        const result = await setRenewalStage(dragged.policyId, stage);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message);
        router.refresh();
      });
    } catch {
      toast.error("No se pudo mover la renovación.");
    }
  }

  async function confirmLost() {
    if (!confirmation) return;
    setConfirmationPending(true);
    try {
      const result = await setRenewalStage(confirmation.policyId, "LOST");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setConfirmation(null);
      router.refresh();
    } finally {
      setConfirmationPending(false);
    }
  }

  return (
    <>
      <section
        id={`renewal-stage-${stage}`}
        aria-label={`${renewalStageLabel(stage)}: ${count} renovaciones`}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setDragOver(false);
        }}
        onDrop={handleDrop}
        className={cn(
          "flex w-72 shrink-0 snap-start flex-col self-start rounded-xl bg-muted/40 ring-1 ring-border transition-colors",
          dragOver && stage === "LOST" && "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-950/30 dark:ring-rose-800",
          dragOver && stage !== "LOST" && "bg-primary/5 ring-2 ring-primary/30",
          !acceptsDrop && "cursor-not-allowed",
        )}
      >
        {children}
      </section>
      {stage === "WON" ? (
        <span className="sr-only">Para marcar una renovación como renovada, captura la póliza nueva.</span>
      ) : null}
      <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && !confirmationPending && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar renovación de {confirmation?.policyNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se marcará como no continuada y se cerrará el pendiente relacionado. El estado de la póliza no cambiará.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmationPending}>Cancelar</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={confirmationPending} onClick={confirmLost}>
              {confirmationPending ? "Procesando..." : "Cerrar renovación"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function RenewalBoardStageNavigation({
  columns,
}: {
  columns: Array<{ stage: RenewalStage; count: number }>;
}) {
  function jumpTo(stage: RenewalStage) {
    document.getElementById(`renewal-stage-${stage}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  return (
    <div className="sticky top-2 z-20 rounded-xl border border-border/80 bg-background/95 p-2 shadow-sm backdrop-blur">
      <nav aria-label="Etapas de renovación" className="flex flex-wrap gap-2">
        {columns.map(({ stage, count }) => (
          <button
            key={stage}
            type="button"
            onClick={() => jumpTo(stage)}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {renewalStageLabel(stage)}
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">{count}</span>
          </button>
        ))}
      </nav>
      <p className="px-3 pt-1 text-[11px] text-muted-foreground">
        Elige una etapa o desplaza el tablero. Arrastra desde el asa; con teclado o pantalla táctil usa «Mover».
      </p>
    </div>
  );
}
