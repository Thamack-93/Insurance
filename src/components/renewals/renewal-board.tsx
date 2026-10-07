import Link from "next/link";
import { AlertTriangle, CalendarClock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RenewalBoardFilters as BoardFilters } from "@/components/renewals/renewal-board-filters";
import { RenewalFollowUpMenu } from "@/components/renewals/renewal-follow-up-menu";
import { RenewalWhatsAppAssistant } from "@/components/renewals/renewal-whatsapp-assistant";
import { DraggableRenewalCard, RenewalBoardInteractions, RenewalBoardScrollArea, RenewalBoardStageNavigation, RenewalDropColumn } from "@/components/renewals/renewal-board-interactions";
import { formatDate } from "@/lib/dates";
import { formatBusinessDateInput } from "@/lib/business-dates";
import { formatCurrency } from "@/lib/money";
import { getRenewalStageTone, policyTypeLabel, renewalStageLabel, statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { RenewalBoardCard, RenewalBoardColumn, RenewalBoardData, RenewalBoardExcludedPolicy } from "@/lib/renewal-board";
import type { RenewalBoardFilters } from "@/lib/renewal-board.logic";
import { isTerminalRenewalStage } from "@/lib/renewal-board.logic";
import { isOverdue } from "@/lib/dates";
import { StatusBadge } from "@/components/badges/status-badge";
import { getPolicyObjectDescription } from "@/lib/policy-identity";

function compactFollowUpDate(date: Date) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "Etc/GMT+6",
  }).format(date).replace(".", "");
}

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

function RenewalCard({ card, isDemo, isDraggable }: { card: RenewalBoardCard; isDemo: boolean; isDraggable: boolean }) {
  const closed = isTerminalRenewalStage(card.stage);
  const overdue = !closed && card.daysUntilRenewal < 0;
  const captureHref = card.canCapture ? `/policies/new?renewalFrom=${card.policyId}` : undefined;

  return (
    <div className="cursor-default rounded-xl bg-card p-3 ring-1 ring-border shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className={cn("flex items-start justify-between gap-2", isDraggable && "pl-8")}>
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
      <p className="mt-1 truncate text-xs text-muted-foreground" title={getPolicyObjectDescription(card)}>
        {getPolicyObjectDescription(card)}
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="col-span-2 flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dt className="sr-only">Vencimiento</dt>
          <dd className="font-mono text-xs">{formatDate(card.endDate)}</dd>
          <dd className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
            {closed ? `Cerró ${formatDate(card.endDate)}` : daysLabel(card.daysUntilRenewal)}
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
        {card.manualFollowUp ? (
          <p className={cn("flex items-center justify-end gap-1.5 text-xs", isOverdue(card.manualFollowUp.dueDate) ? "text-destructive" : "text-muted-foreground")}>
            <CalendarClock className="size-3.5" aria-hidden="true" />
            <span>{isOverdue(card.manualFollowUp.dueDate) ? "Seguimiento vencido" : "Seguimiento"} · {compactFollowUpDate(card.manualFollowUp.dueDate)}</span>
          </p>
        ) : null}
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
          <div className="flex flex-wrap items-center justify-start gap-2">
            <RenewalWhatsAppAssistant policyId={card.policyId} policyNumber={card.policyNumber} clientName={card.clientName} stage={card.stage} isDemo={isDemo} />
            <RenewalFollowUpMenu
              policyId={card.policyId}
              policyNumber={card.policyNumber}
              currentDueDate={card.manualFollowUp ? formatBusinessDateInput(card.manualFollowUp.dueDate) : null}
              currentNotes={card.manualFollowUp?.notes ?? null}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function excludedReasonLabel(policy: RenewalBoardExcludedPolicy) {
  if (policy.reason === "INACTIVE") return `Estado: ${statusLabel(policy.status, "policy")}`;
  if (policy.reason === "CANCELLED_RECEIPT") return "Último recibo cancelado";
  if (policy.reason === "OUTSIDE_WINDOW") return "Fuera de la ventana seleccionada";
  return "No elegible para renovación";
}

function ExcludedPolicies({ policies }: { policies: RenewalBoardExcludedPolicy[] }) {
  if (!policies.length) return null;

  return (
    <section className="rounded-xl bg-card ring-1 ring-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="font-medium">Relacionadas, fuera del tablero accionable</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Se muestran para explicar por qué una póliza encontrada no aparece como renovación trabajable.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full">{policies.length}</Badge>
      </div>
      <div className="max-h-72 overflow-auto">
        <ul className="divide-y divide-border">
          {policies.map((policy) => (
            <li key={policy.policyId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/policies/${policy.policyId}`} className="font-mono font-medium hover:underline">
                    {policy.policyNumber}
                  </Link>
                  <StatusBadge status={policy.status} entity="policy" className="px-2 py-0.5 text-[11px]" />
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={getPolicyObjectDescription(policy)}>
                  {getPolicyObjectDescription(policy)}
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {policy.clientName} · {policy.insurerName} · vence {formatDate(policy.endDate)}
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground sm:text-right">{excludedReasonLabel(policy)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function BoardColumn({ column, isDemo }: { column: RenewalBoardColumn; isDemo: boolean }) {
  return (
    <RenewalDropColumn stage={column.stage} count={column.count}>
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
        <ul className="flex flex-col gap-2 p-2">
          {column.cards.map((card) => (
            <DraggableRenewalCard key={card.policyId} policyId={card.policyId} policyNumber={card.policyNumber} stage={card.stage}>
              <RenewalCard card={card} isDemo={isDemo} isDraggable={card.stage !== "WON" && card.stage !== "LOST"} />
            </DraggableRenewalCard>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Sin renovaciones en esta etapa.</p>
      )}
    </RenewalDropColumn>
  );
}

export function RenewalBoard({
  board,
  filters,
  owners,
  canFilterByOwner,
  isDemo,
}: {
  board: RenewalBoardData;
  filters: RenewalBoardFilters;
  owners: { id: string; name: string }[];
  canFilterByOwner: boolean;
  isDemo: boolean;
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

      {board.total > 0 ? <RenewalBoardStageNavigation columns={board.columns} /> : null}

      {board.truncated ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60">
          Hay más renovaciones de las que el tablero puede mostrar de una vez. Filtra por ventana o responsable para trabajarlas
          por partes.
        </p>
      ) : null}

      <ExcludedPolicies policies={board.excludedPolicies} />

      {board.total === 0 ? (
        <p className="rounded-xl bg-card px-4 py-12 text-center text-muted-foreground ring-1 ring-border">
          No hay renovaciones en esta ventana. Prueba con un rango más amplio.
        </p>
      ) : (
        <RenewalBoardInteractions>
          <RenewalBoardScrollArea>
            {board.columns.map((column) => (
              <BoardColumn key={column.stage} column={column} isDemo={isDemo} />
            ))}
          </RenewalBoardScrollArea>
        </RenewalBoardInteractions>
      )}
    </div>
  );
}
