import {
  Activity,
  ArrowRight,
  BellRing,
  CircleCheck,
  CircleX,
  FilePlus2,
  FileSignature,
  History,
  PlayCircle,
  ShieldAlert,
  Siren,
  Trash2,
  Wallet,
} from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import { formatRelativeDate, formatDate } from "@/lib/dates";

export type ActivityTimelineEntry = {
  id: string;
  entityType: string;
  action: string;
  userId: string;
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
  // Las claves se resuelven por prefijo y en orden de inserción: todo lo que
  // empiece con RENEWAL_ debe ir antes que RENEW o quedaría rotulado "Renovado".
  RENEWAL_STAGE_CHANGE: { icon: ArrowRight, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  RENEWAL_FOLLOWUP_REMINDER: { icon: BellRing, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  RENEWAL_DECLINED: { icon: CircleX, tone: "bg-muted text-muted-foreground" },
  RENEW: { icon: History, tone: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  SECURITY_LOGIN_FAILED: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_LOGIN_DISABLED: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_RATE_LIMITED: { icon: Siren, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  SECURITY_INVALID_SECRET: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_INVALID_PAYLOAD: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_SAME_ORIGIN_BLOCKED: { icon: ShieldAlert, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
  SECURITY_ACCESS_DENIED_DOCUMENT: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_ACCESS_DENIED_FILE_PATH: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_ACCESS_DENIED: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_PDF_PARSE_FAILED: { icon: ShieldAlert, tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  SECURITY_PDF_NO_TEXT: { icon: Siren, tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" },
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
  RENEWAL_STAGE_CHANGE: "Etapa de renovación",
  RENEWAL_FOLLOWUP_REMINDER: "Recordatorio de renovación",
  RENEWAL_DECLINED: "No renueva",
  RENEWAL_LINKED: "Renovación vinculada",
  RENEW: "Renovado",
  SECURITY_LOGIN_FAILED: "Inicio de sesión fallido",
  SECURITY_LOGIN_DISABLED: "Acceso bloqueado",
  SECURITY_RATE_LIMITED: "Límite de tasa",
  SECURITY_INVALID_SECRET: "Secret inválido",
  SECURITY_INVALID_PAYLOAD: "Payload inválido",
  SECURITY_SAME_ORIGIN_BLOCKED: "Mutación bloqueada",
  SECURITY_ACCESS_DENIED_DOCUMENT: "Acceso a documento bloqueado",
  SECURITY_ACCESS_DENIED_FILE_PATH: "Ruta de archivo inválida",
  SECURITY_ACCESS_DENIED: "Acceso denegado",
  SECURITY_PDF_PARSE_FAILED: "Error al analizar PDF",
  SECURITY_PDF_NO_TEXT: "PDF sin texto extraíble",
};

const entityLabelMap: Record<string, string> = {
  Client: "Cliente",
  Policy: "Póliza",
  Insurer: "Aseguradora",
  Receipt: "Recibo",
  Claim: "Siniestro",
  Quote: "Cotización",
  WorkItem: "Pendiente",
  Payment: "Pago",
  Commission: "Comisión",
  Document: "Documento",
  SecurityEvent: "Seguridad",
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

export async function ActivityTimeline({
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

  const ids = Array.from(new Set(data.map((d) => d.userId).filter(Boolean)));
  let userMap = new Map<string, string>();
  if (ids.length > 0) {
    const db = getDb();
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    userMap = new Map(users.map((u) => [u.id, u.name]));
  }

  return (
    <ol className={cn("divide-y divide-border/70", className)}>
      {data.map((entry) => {
        const { icon: Icon, tone } = lookupAction(entry.action);
        const actionLabel = formatActionLabel(entry.action);
        const date = new Date(entry.createdAt);
        const distance = formatRelativeDate(entry.createdAt);
        const fullDate = formatDate(date, "d 'de' MMMM yyyy, HH:mm");
        const performer = userMap.get(entry.userId) ?? "Sistema";

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
                Por {performer}
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
