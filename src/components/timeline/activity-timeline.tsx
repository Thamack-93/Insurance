import {
  Activity,
  CircleCheck,
  CircleX,
  FilePlus2,
  FileSignature,
  History,
  PlayCircle,
  Trash2,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ActivityTimelineEntry = {
  id: string;
  entityType: string;
  action: string;
  performedBy: string;
  createdAt: Date | string;
};

type IconTone = {
  icon: LucideIcon;
  tone: string;
};

const actionIconMap: Record<string, IconTone> = {
  CREATE: { icon: FilePlus2, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  UPDATE: { icon: FileSignature, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  DELETE: { icon: Trash2, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  PAY: { icon: Wallet, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  PAID: { icon: Wallet, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  CANCEL: { icon: CircleX, tone: "bg-muted text-muted-foreground" },
  CLOSE: { icon: CircleCheck, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  REOPEN: { icon: PlayCircle, tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  RENEW: { icon: History, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
};

const defaultIcon: IconTone = { icon: Activity, tone: "bg-muted text-muted-foreground" };

const actionLabelMap: Record<string, string> = {
  CREATE: "Creado",
  UPDATE: "Actualizado",
  DELETE: "Eliminado",
  PAY: "Pago registrado",
  PAID: "Pago registrado",
  CANCEL: "Cancelado",
  CLOSE: "Cerrado",
  REOPEN: "Reabierto",
  RENEW: "Renovado",
};

const entityLabelMap: Record<string, string> = {
  Client: "Cliente",
  Policy: "Póliza",
  Insurer: "Aseguradora",
  Receipt: "Recibo",
  Claim: "Siniestro",
  Quote: "Cotización",
  Task: "Tarea",
  Payment: "Pago",
  Commission: "Comisión",
  Document: "Documento",
};

function lookupAction(action: string): IconTone {
  const upper = action.toUpperCase();
  for (const key of Object.keys(actionIconMap)) {
    if (upper.startsWith(key)) return actionIconMap[key];
  }
  return defaultIcon;
}

function formatActionLabel(action: string) {
  const upper = action.toUpperCase();
  for (const key of Object.keys(actionLabelMap)) {
    if (upper === key || upper.startsWith(`${key}_`) || upper.startsWith(key)) {
      return actionLabelMap[key];
    }
  }
  return action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatEntity(entityType: string) {
  return entityLabelMap[entityType] ?? entityType;
}

function formatPerformer(performedBy: string) {
  if (!performedBy || performedBy === "local-ui" || performedBy === "local-user") {
    return "Sistema";
  }
  return performedBy;
}

export function ActivityTimeline({
  entries,
  items,
  showEntity = false,
  emptyText = "Sin actividad registrada todavía.",
  className,
}: {
  entries?: ActivityTimelineEntry[];
  /** @deprecated use `entries` */
  items?: ActivityTimelineEntry[];
  showEntity?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const data = entries ?? items ?? [];

  if (data.length === 0) {
    return (
      <div className={cn("px-4 py-6 text-sm text-muted-foreground", className)}>{emptyText}</div>
    );
  }

  return (
    <ol className={cn("divide-y divide-border/70", className)}>
      {data.map((entry) => {
        const { icon: Icon, tone } = lookupAction(entry.action);
        const actionLabel = formatActionLabel(entry.action);
        const date = new Date(entry.createdAt);
        const distance = formatDistanceToNow(date, { locale: es, addSuffix: true });
        const fullDate = format(date, "d 'de' MMMM yyyy, HH:mm", { locale: es });

        return (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
            <span
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                tone,
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
              <p className="font-medium text-foreground">
                {actionLabel}
                {showEntity ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formatEntity(entry.entityType)}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Por {formatPerformer(entry.performedBy)}
                <span className="mx-1.5 text-muted-foreground/60">·</span>
                <Tooltip>
                  <TooltipTrigger className="cursor-help underline-offset-2 hover:underline">
                    {distance}
                  </TooltipTrigger>
                  <TooltipContent>{fullDate}</TooltipContent>
                </Tooltip>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
