"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type PointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, GripVertical } from "lucide-react";
import { setRenewalStage } from "@/app/(dashboard)/renewals/actions";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { renewalStageLabel } from "@/lib/status";
import type { RenewalStage } from "@/lib/renewal-board.logic";
import { cn } from "@/lib/utils";

type DraggedRenewal = { policyId: string; policyNumber: string; stage: RenewalStage };
type RenewalDragSession = DraggedRenewal & {
  pointerId: number;
  startX: number;
  startY: number;
  isDragging: boolean;
  overStage: RenewalStage | null;
};

type RenewalDragContextValue = {
  session: RenewalDragSession | null;
  beginDrag: (event: PointerEvent<HTMLSpanElement>, renewal: DraggedRenewal) => void;
  refreshDropTarget: (x: number, y: number) => void;
};

const RenewalDragContext = createContext<RenewalDragContextValue | null>(null);
const DRAG_THRESHOLD = 6;

function useRenewalDragContext() {
  const context = useContext(RenewalDragContext);
  if (!context) throw new Error("Renewal drag components must be inside RenewalBoardInteractions.");
  return context;
}

function stageAtPoint(x: number, y: number): RenewalStage | null {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-renewal-drop-stage]");
  return (target?.dataset.renewalDropStage as RenewalStage | undefined) ?? null;
}

export function RenewalBoardInteractions({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<RenewalDragSession | null>(null);
  const [confirmation, setConfirmation] = useState<DraggedRenewal | null>(null);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [pending, startTransition] = useTransition();

  function beginDrag(event: PointerEvent<HTMLSpanElement>, renewal: DraggedRenewal) {
    if (event.button !== 0 || pending || confirmationPending) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSession({
      ...renewal,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isDragging: false,
      overStage: null,
    });
  }

  function updateDragTarget(event: PointerEvent<HTMLDivElement>) {
    if (!session || session.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= DRAG_THRESHOLD;
    if (!moved && !session.isDragging) return;
    const isDragging = session.isDragging || moved;
    const overStage = isDragging ? stageAtPoint(event.clientX, event.clientY) : null;
    setSession((current) => {
      if (!current || current.pointerId !== event.pointerId) return current;
      if (current.isDragging === isDragging && current.overStage === overStage) return current;
      return { ...current, isDragging, overStage };
    });
  }

  function refreshDropTarget(x: number, y: number) {
    const overStage = stageAtPoint(x, y);
    setSession((current) => current?.isDragging && current.overStage !== overStage
      ? { ...current, overStage }
      : current);
  }

  function dropRenewal(renewal: DraggedRenewal, stage: RenewalStage) {
    if (stage === renewal.stage) return;
    if (stage === "WON") {
      toast.info("Para marcarla como renovada, captura primero la póliza nueva desde la tarjeta.");
      return;
    }
    if (stage === "LOST") {
      setConfirmation(renewal);
      return;
    }

    startTransition(async () => {
      const result = await setRenewalStage(renewal.policyId, stage);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const active = session;
    if (!active || active.pointerId !== event.pointerId) return;
    setSession(null);

    const moved = Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= DRAG_THRESHOLD;
    const targetStage = stageAtPoint(event.clientX, event.clientY);
    if (moved && targetStage) dropRenewal(active, targetStage);
  }

  function cancelDrag(event: PointerEvent<HTMLDivElement>) {
    setSession((current) => current?.pointerId === event.pointerId ? null : current);
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
    <RenewalDragContext.Provider value={{ session, beginDrag, refreshDropTarget }}>
      <div onPointerMove={updateDragTarget} onPointerUp={finishDrag} onPointerCancel={cancelDrag}>
        {children}
      </div>
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
    </RenewalDragContext.Provider>
  );
}

export function RenewalBoardScrollArea({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
  const latestPointer = useRef<{ x: number; y: number } | null>(null);
  const autoScrollDirection = useRef(0);
  const autoScrollFrame = useRef<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);
  const { session, refreshDropTarget } = useRenewalDragContext();

  useEffect(() => () => {
    if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const updateScrollState = () => {
      setCanScrollForward(element.scrollLeft + element.clientWidth < element.scrollWidth - 4);
    };

    element.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);
    if (element.firstElementChild) resizeObserver.observe(element.firstElementChild);

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, []);

  function stopAutoScroll() {
    autoScrollDirection.current = 0;
    latestPointer.current = null;
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
  }

  function startAutoScroll() {
    if (autoScrollFrame.current !== null) return;
    const tick = () => {
      const element = viewport.current;
      if (!element || autoScrollDirection.current === 0) {
        autoScrollFrame.current = null;
        return;
      }
      const previous = element.scrollLeft;
      element.scrollLeft += autoScrollDirection.current * 14;
      if (element.scrollLeft === previous) {
        autoScrollFrame.current = null;
        return;
      }
      if (latestPointer.current) refreshDropTarget(latestPointer.current.x, latestPointer.current.y);
      autoScrollFrame.current = requestAnimationFrame(tick);
    };
    autoScrollFrame.current = requestAnimationFrame(tick);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-renewal-card], [data-renewal-drag-handle], a, button, input, select, textarea")) return;

    pan.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId === event.pointerId) {
      const distance = event.clientX - pan.current.startX;
      if (Math.abs(distance) >= DRAG_THRESHOLD) setIsPanning(true);
      event.currentTarget.scrollLeft = pan.current.scrollLeft - distance;
      return;
    }

    if (!session?.isDragging || session.pointerId !== event.pointerId) {
      stopAutoScroll();
      return;
    }

    latestPointer.current = { x: event.clientX, y: event.clientY };
    const bounds = event.currentTarget.getBoundingClientRect();
    const edgeSize = Math.min(72, bounds.width * 0.16);
    autoScrollDirection.current = event.clientX < bounds.left + edgeSize
      ? -1
      : event.clientX > bounds.right - edgeSize
        ? 1
        : 0;
    if (autoScrollDirection.current) startAutoScroll();
    else stopAutoScroll();
  }

  function finishPan(event: PointerEvent<HTMLDivElement>) {
    stopAutoScroll();
    if (pan.current?.pointerId === event.pointerId) {
      pan.current = null;
      setIsPanning(false);
    }
  }

  function scrollForward() {
    const element = viewport.current;
    if (!element) return;
    element.scrollBy({ left: Math.max(240, element.clientWidth * 0.75), behavior: "smooth" });
  }

  return (
    <div className="relative min-w-0">
      <div
        ref={viewport}
        data-renewal-board-viewport
        role="region"
        aria-label="Tablero de renovaciones"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        className={cn(
          "min-w-0 touch-pan-y overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:thin]",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div className="flex w-max items-start gap-3">{children}</div>
      </div>
      {canScrollForward ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center bg-gradient-to-l from-background via-background/90 to-transparent pb-3 pl-8 pr-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Ver siguientes etapas"
            className="pointer-events-auto size-10 rounded-full shadow-md"
            onClick={scrollForward}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DraggableRenewalCard({
  policyId,
  policyNumber,
  stage,
  children,
}: DraggedRenewal & { children: ReactNode }) {
  const canDrag = stage !== "WON" && stage !== "LOST";
  const { session, beginDrag } = useRenewalDragContext();
  const isDragging = session?.policyId === policyId && session.isDragging;

  return (
    <li data-renewal-card className={cn("relative rounded-xl", isDragging && "opacity-50")}>
      {canDrag ? (
        <span
          data-renewal-drag-handle
          onPointerDown={(event) => beginDrag(event, { policyId, policyNumber, stage })}
          title="Arrastra para mover"
          aria-hidden="true"
          className="absolute left-2 top-2 z-10 inline-flex size-7 touch-none select-none items-center justify-center rounded-md text-muted-foreground/70 cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing"
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
  const { session } = useRenewalDragContext();
  const dragOver = Boolean(session?.isDragging && session.overStage === stage && session.stage !== stage && stage !== "WON");

  return (
    <section
      id={`renewal-stage-${stage}`}
      data-renewal-drop-stage={stage}
      aria-label={`${renewalStageLabel(stage)}: ${count} renovaciones`}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col self-start rounded-xl bg-muted/40 ring-1 ring-border transition-colors",
        dragOver && stage === "LOST" && "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-950/30 dark:ring-rose-800",
        dragOver && stage !== "LOST" && "bg-primary/5 ring-2 ring-primary/30",
        stage === "WON" && session?.isDragging && "cursor-not-allowed",
      )}
    >
      {children}
    </section>
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
    <div className="sticky top-2 z-20 bg-background/95 py-1 backdrop-blur">
      <nav aria-label="Etapas de renovación" className="flex flex-wrap items-center gap-1 border-b border-border/70 pb-2">
        {columns.map(({ stage, count }) => (
          <button
            key={stage}
            type="button"
            aria-controls={`renewal-stage-${stage}`}
            onClick={() => jumpTo(stage)}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {renewalStageLabel(stage)}
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">{count}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
