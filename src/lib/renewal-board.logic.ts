// Lógica pura del tablero de renovaciones — sin "use server" ni Prisma, para
// que pueda probarse sin contexto de Next.js.
//
// La elegibilidad de renovación (qué póliza entra al embudo) sigue viviendo en
// `renewals.logic.ts` y `renewal-decisions.ts`. Aquí sólo se resuelve en qué
// columna cae cada tarjeta y cuándo una renovación lleva demasiado tiempo sin
// avanzar.

import {
  businessAddDays,
  businessToday,
  daysBetweenBusinessDates,
  getBusinessDateKey,
  parseBusinessDateInput,
} from "@/lib/business-dates";
import { RENEWAL_STAGES, TERMINAL_RENEWAL_STAGES, type RenewalStage } from "@/lib/domain-values";
import { readTableParam, type TableSearchParams } from "@/lib/table-query";

export type { RenewalStage };
export { RENEWAL_STAGES };

/** Etapas que el usuario puede elegir al mover una tarjeta. */
export function isRenewalStage(value: string): value is RenewalStage {
  return (RENEWAL_STAGES as readonly string[]).includes(value);
}

export function isTerminalRenewalStage(stage: RenewalStage) {
  return (TERMINAL_RENEWAL_STAGES as readonly string[]).includes(stage);
}

export function canScheduleRenewalManualFollowUp(stage: RenewalStage) {
  return !isTerminalRenewalStage(stage);
}

/**
 * La columna de una tarjeta no es sólo la etapa guardada: los dos desenlaces
 * ya tienen una fuente de verdad anterior al tablero y ésa manda.
 *
 * - Una póliza en estatus RENEWED se renovó de verdad a través del alta de
 *   póliza de renovación, así que cae en "Renovado" aunque nadie haya movido
 *   la tarjeta.
 * - Una póliza con una sugerencia de renovación rechazada pasó por el flujo de
 *   "No renueva", así que cae en "Perdido".
 */
export function resolveRenewalStage(input: {
  policyStatus: string;
  renewalStage: string | null | undefined;
  hasDeclinedSuggestion: boolean;
}): RenewalStage {
  if (input.policyStatus === "RENEWED") return "WON";
  if (input.hasDeclinedSuggestion) return "LOST";
  if (input.renewalStage && isRenewalStage(input.renewalStage)) return input.renewalStage;
  return "PENDING";
}

// ------------------------------------------------------- ventana de vencimiento

export const RENEWAL_BOARD_WINDOWS = ["overdue", "30", "60", "90"] as const;
export type RenewalBoardWindow = (typeof RENEWAL_BOARD_WINDOWS)[number];

export const DEFAULT_RENEWAL_BOARD_WINDOW: RenewalBoardWindow = "60";

export const renewalBoardWindowLabels: Record<RenewalBoardWindow, string> = {
  overdue: "Sólo vencidas",
  "30": "Hasta 30 días",
  "60": "Hasta 60 días",
  "90": "Hasta 90 días",
};

export const UNASSIGNED_OWNER_VALUE = "unassigned";

export type RenewalBoardFilters = {
  window: RenewalBoardWindow;
  /** Id del responsable, o `unassigned` para las carteras sin dueño. */
  owner?: string;
  /** Busca por cliente, número de póliza o aseguradora. */
  query?: string;
};

export function readRenewalBoardFilters(params: TableSearchParams): RenewalBoardFilters {
  const owner = readTableParam(params, "owner")?.trim();
  const query = readTableParam(params, "q")?.trim();
  const rawWindow = readTableParam(params, "window");
  const legacyWindow = rawWindow === "30d" || rawWindow === "60d" || rawWindow === "90d"
    ? rawWindow.slice(0, -1)
    : rawWindow;
  return {
    window: RENEWAL_BOARD_WINDOWS.find((value) => value === legacyWindow) ?? DEFAULT_RENEWAL_BOARD_WINDOW,
    owner: owner ? owner.slice(0, 40) : undefined,
    query: query ? query.slice(0, 100) : undefined,
  };
}

/**
 * Las ventanas numéricas incluyen las renovaciones ya vencidas: son las más
 * urgentes y esconderlas detrás de otro filtro es justo lo que hace que se
 * pierdan. "Sólo vencidas" existe para trabajarlas aisladas.
 */
export function renewalWindowRange(
  window: RenewalBoardWindow,
  today: Date = businessToday(),
): { from?: Date; to?: Date } {
  if (window === "overdue") return { to: businessAddDays(today, -1) };
  return { to: businessAddDays(today, Number(window)) };
}

// -------------------------------------------------- recordatorios de seguimiento

/**
 * Días sin avance que convierten una renovación en estancada, por etapa.
 * `null` marca las etapas terminales: ya no hay nada que empujar.
 */
export const RENEWAL_STALL_DAYS: Record<RenewalStage, number | null> = {
  PENDING: 7,
  CONTACTED: 5,
  QUOTED: 5,
  WON: null,
  LOST: null,
};

/**
 * Una renovación que nadie ha tocado sólo se considera estancada cuando ya
 * entró en el mes previo al vencimiento; antes de eso no hay nada que reclamar.
 */
export const RENEWAL_UNTOUCHED_WINDOW_DAYS = 30;

export type RenewalStallReason = "never-started" | "no-progress";

export type RenewalStallState = {
  stalled: boolean;
  reason: RenewalStallReason | null;
  daysSinceLastMove: number | null;
};

export function getRenewalStallState(input: {
  stage: RenewalStage;
  /** Fecha del último cambio de etapa; `null` si la tarjeta nunca se movió. */
  stageChangedAt: Date | null;
  daysUntilRenewal: number;
  today?: Date;
}): RenewalStallState {
  const today = input.today ?? businessToday();

  if (isTerminalRenewalStage(input.stage)) {
    return { stalled: false, reason: null, daysSinceLastMove: null };
  }

  if (!input.stageChangedAt) {
    return {
      stalled: input.daysUntilRenewal <= RENEWAL_UNTOUCHED_WINDOW_DAYS,
      reason: input.daysUntilRenewal <= RENEWAL_UNTOUCHED_WINDOW_DAYS ? "never-started" : null,
      daysSinceLastMove: null,
    };
  }

  const daysSinceLastMove = Math.max(0, daysBetweenBusinessDates(today, input.stageChangedAt));
  const threshold = RENEWAL_STALL_DAYS[input.stage];
  const stalled = threshold !== null && daysSinceLastMove >= threshold;

  return {
    stalled,
    reason: stalled ? "no-progress" : null,
    daysSinceLastMove,
  };
}

/** Lunes de la semana de negocio a la que pertenece la fecha, como clave. */
export function businessWeekKey(date: Date = businessToday()): string {
  const key = getBusinessDateKey(date);
  const parsed = parseBusinessDateInput(key);
  // getUTCDay(): 0 = domingo. La semana operativa arranca en lunes.
  const weekday = parsed.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return getBusinessDateKey(businessAddDays(parsed, offset));
}

/**
 * Un recordatorio por póliza, etapa y semana: si la renovación sigue sin
 * avanzar la semana que entra vuelve a sonar, pero nunca se convierte en un
 * aviso diario.
 */
export function renewalFollowUpDedupeKey(policyId: string, stage: RenewalStage, weekKey: string) {
  return `RENEWAL_FOLLOWUP:${policyId}:${stage}:${weekKey}`;
}

/**
 * Distingue los pendientes que crea el barrido de seguimiento de los pendientes
 * de renovación normales, que tienen su propio ciclo de vida.
 */
export const RENEWAL_FOLLOWUP_SOURCE_SUFFIX = ":renewal-followup";

/** Identidad estable del siguiente seguimiento elegido por el operador. */
export const RENEWAL_MANUAL_FOLLOWUP_SOURCE_SUFFIX = ":renewal-manual-followup";

export function renewalFollowUpWorkItemSourceId(policyId: string) {
  return `policy:${policyId}${RENEWAL_FOLLOWUP_SOURCE_SUFFIX}`;
}

export function renewalManualFollowUpWorkItemSourceId(policyId: string) {
  return `policy:${policyId}${RENEWAL_MANUAL_FOLLOWUP_SOURCE_SUFFIX}`;
}

export type RenewalFollowUpShortcut = "tomorrow" | "three-days" | "one-week";

export function renewalFollowUpShortcutDate(
  shortcut: RenewalFollowUpShortcut,
  today: Date = businessToday(),
) {
  const days = shortcut === "tomorrow" ? 1 : shortcut === "three-days" ? 3 : 7;
  return businessAddDays(today, days);
}

export function buildRenewalFollowUpMessage(input: {
  policyNumber: string;
  clientName: string;
  stageLabel: string;
  daysUntilRenewal: number;
  stall: RenewalStallState;
}) {
  const expiry =
    input.daysUntilRenewal < 0
      ? `venció hace ${Math.abs(input.daysUntilRenewal)} días`
      : input.daysUntilRenewal === 0
        ? "vence hoy"
        : `vence en ${input.daysUntilRenewal} días`;

  const stall =
    input.stall.reason === "never-started"
      ? "Nadie ha registrado avance todavía."
      : `Sin avance desde hace ${input.stall.daysSinceLastMove} días.`;

  return {
    title: `Renovación sin avance: ${input.policyNumber}`,
    body: [
      `Cliente: ${input.clientName}`,
      `Etapa actual: ${input.stageLabel}`,
      `La póliza ${expiry}.`,
      stall,
    ].join("\n"),
  };
}
