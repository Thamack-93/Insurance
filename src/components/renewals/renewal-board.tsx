import Link from "next/link";
import { AlertTriangle, CalendarClock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RenewalBoardFilters as BoardFilters } from "@/components/renewals/renewal-board-filters";
import { RenewalStageMenu } from "@/components/renewals/renewal-stage-menu";
import { RenewalWhatsAppAssistant } from "@/components/renewals/renewal-whatsapp-assistant";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { getRenewalStageTone, policyTypeLabel, renewalStageLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RenewalBoardCard, RenewalBoardColumn, RenewalBoardData } from "@/lib/renewal-board";
import { RENEWAL_BOARD_COLUMN_PREVIEW } from "@/lib/renewal-board";
import type { RenewalBoardFilters } from "@/lib/renewal-board.logic";
import { isTerminalRenewalStage } from "@/lib/renewal-board.logic";

const stageAccent: Record<string, string> = {
  PENDING: "bg-muted-foreground/40",
  CONTACTED: "bg-amber-500",
  QUOTED: "bg-sky-500",
  WON: "bg-emerald-600",
  LOST: "bg-rose-500",
};

const badgeTone: Record<string, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
};

function daysLabel(days: number) {
  if (days === 0) return "Vence hoy";
  if (days < 0) return `Venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? "día" : "días"}`;
  return `Faltan ${days} ${days === 1 ? "día" : "días"}`;
}

function RenewalCard({ card }: { card: RenewalBoardCard }) {
  const overdue = card.daysUntilRenewal < 0;
  const captureHref = card.canCapture ? `/policies/new?renewalFrom=${card.policyId}` : undefined;

  return (
    <li className="rounded-xl bg-card p-3 ring-1 ring-border shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/clients/${card.clientId}`}
          className="min-w-0 rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="line-clamp-2">{card.clientName}</span>
        </Link>
        {card.stall.stalled ? (
          <Badge variant="outline" className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", badgeTone.warning)}>
            <AlertTriangle className="size-3" aria-hidden="true" />
            Sin avance
          </Badge>
        ) : null}
      </div>

      <p className="mt-1 truncate text-sm text-muted-foreground">
        <Link
          href={`/policies/${card.policyId}`}
          className="rounded-sm font-mono hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {card.policyNumber}
        </Link>
        {" · "}
        {policyTypeLabel(card.policyType)}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="col-span-2 flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="sr-only">Vencimiento</dt>
          <dd className="font-mono text-xs">{formatDate(card.endDate)}</dd>
          <dd className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
            {daysLabel(card.daysUntilRenewal)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Prima</dt>
          <dd className="font-mono">{formatCurrency(card.premiumAmount, card.currency)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Responsable</dt>
          <dd className="truncate text-sm">{card.ownerName ?? "Sin asignar"}</dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        {card.renewedToPolicyId || captureHref ? (
          <div className="flex justify-end">
            {card.renewedToPolicyId ? (
              <Link href={`/policies/${card.renewedToPolicyId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Ver renovación</Link>
            ) : captureHref ? (
              <Link href={captureHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Capturar renovación</Link>
            ) : null}
          </div>
        ) : null}
        {!isTerminalRenewalStage(card.stage) ? (
          <div className="flex items-center justify-end gap-2">
            <RenewalWhatsAppAssistant policyId={card.policyId} clientName={card.clientName} stage={card.stage} />
            <RenewalStageMenu policyId={card.policyId} policyNumber={card.policyNumber} stage={card.stage} captureHref={captureHref} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function BoardColumn({ column }: { column: RenewalBoardColumn }) {
  const hidden = column.count - column.cards.length;

  return (
    <section
      aria-label={`${renewalStageLabel(column.stage)}: ${column.count} renovaciones`}
      className="flex w-72 shrink-0 snap-start flex-col self-start rounded-xl bg-muted/40 ring-1 ring-border"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-medium">
            <span className={cn("size-2 shrink-0 rounded-full", stageAccent[column.stage])} aria-hidden="true" />
            <span className="truncate">{renewalStageLabel(column.stage)}</span>
          </h3>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {column.premiumTotalCurrency
              ? `${formatCurrency(column.premiumTotal, column.premiumTotalCurrency)} en prima`
              : column.count > 0
                ? "Prima en varias monedas"
                : "Sin prima acumulada"}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px]", badgeTone[getRenewalStageTone(column.stage)])}
        >
          {column.count}
        </Badge>
      </header>

      {column.cards.length ? (
        <>
          <ul className="flex flex-col gap-2 p-2">
            {column.cards.map((card) => (
              <RenewalCard key={card.policyId} card={card} />
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Y {hidden} más. Acota la ventana o el responsable para verlas; se muestran las {RENEWAL_BOARD_COLUMN_PREVIEW} más
              próximas a vencer.
            </p>
          ) : null}
        </>
      ) : (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Sin renovaciones en esta etapa.</p>
      )}
    </section>
  );
}

export function RenewalBoard({
  board,
  filters,
  owners,
  canFilterByOwner,
}: {
  board: RenewalBoardData;
  filters: RenewalBoardFilters;
  owners: { id: string; name: string }[];
  canFilterByOwner: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <BoardFilters filters={filters} owners={owners} canFilterByOwner={canFilterByOwner} />
        <p className="text-sm text-muted-foreground" role="status">
          {board.total} {board.total === 1 ? "renovación" : "renovaciones"} en el tablero
          {board.stalledCount > 0 ? ` · ${board.stalledCount} sin avance` : ""}
        </p>
      </div>

      {board.truncated ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60">
          Hay más renovaciones de las que el tablero puede mostrar de una vez. Filtra por ventana o responsable para trabajarlas
          por partes.
        </p>
      ) : null}

      {board.total === 0 ? (
        <p className="rounded-xl bg-card px-4 py-12 text-center text-muted-foreground ring-1 ring-border">
          No hay renovaciones en esta ventana. Prueba con un rango más amplio.
        </p>
      ) : (
        // Un tablero siempre se desplaza en horizontal: cinco columnas legibles
        // no caben en una pantalla angosta, y comprimirlas en rejilla parte los
        // nombres de los clientes.
        <div className="flex min-w-0 snap-x gap-3 overflow-x-auto pb-2">
          {board.columns.map((column) => (
            <BoardColumn key={column.stage} column={column} />
          ))}
        </div>
      )}
    </div>
  );
}
