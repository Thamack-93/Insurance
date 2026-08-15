import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { businessToday, daysBetweenBusinessDates } from "@/lib/business-dates";
import { RENEWAL_STAGES, type RenewalStage } from "@/lib/domain-values";
import { logError } from "@/lib/logger";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "@/lib/renewal-decisions";
import { LATEST_RENEWAL_RECEIPT_INCLUDE, getLatestReceiptStatus } from "@/lib/renewal-receipt";
import { calculateRenewalPriority, shouldIncludeInRenewals, type RenewalPriority } from "@/lib/renewals.logic";
import {
  getRenewalStallState,
  isTerminalRenewalStage,
  renewalWindowRange,
  resolveRenewalStage,
  UNASSIGNED_OWNER_VALUE,
  type RenewalBoardFilters,
  type RenewalStallState,
} from "@/lib/renewal-board.logic";

/**
 * Máximo de pólizas que el tablero carga de una sola vez. Con la ventana más
 * amplia (90 días) una cartera real cabe de sobra; el corte existe para que un
 * catálogo inflado no tumbe la página, y la vista avisa cuando lo alcanza.
 */
export const RENEWAL_BOARD_LIMIT = 400;

/** Tarjetas visibles por columna antes de resumir el resto. */
export const RENEWAL_BOARD_COLUMN_PREVIEW = 25;

export type RenewalBoardCard = {
  organizationId: string;
  policyId: string;
  policyNumber: string;
  policyType: string;
  clientId: string;
  clientName: string;
  insurerId: string;
  insurerName: string;
  endDate: Date;
  daysUntilRenewal: number;
  premiumAmount: number;
  currency: string;
  priority: RenewalPriority;
  stage: RenewalStage;
  stageChangedAt: Date | null;
  ownerId: string | null;
  ownerName: string | null;
  stall: RenewalStallState;
  /** La póliza de renovación todavía no existe: se puede capturar. */
  canCapture: boolean;
  /** Póliza de renovación ya creada, para conservar la trazabilidad. */
  renewedToPolicyId: string | null;
};

export type RenewalBoardColumn = {
  stage: RenewalStage;
  count: number;
  cards: RenewalBoardCard[];
  premiumTotal: number;
  /** `null` cuando la columna mezcla monedas y el total no se puede sumar. */
  premiumTotalCurrency: string | null;
};

export type RenewalBoardData = {
  columns: RenewalBoardColumn[];
  /** Todas las tarjetas del tablero, sin recortar por columna. */
  cards: RenewalBoardCard[];
  total: number;
  stalledCount: number;
  truncated: boolean;
};

const renewalBoardInclude = {
  client: {
    select: { id: true, fullName: true, portfolioOwnerId: true, portfolioOwner: { select: { name: true } } },
  },
  insurer: { select: { name: true } },
  renewals: { select: { id: true }, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1 },
  sourceRenewalSuggestions: { where: { status: "DECLINED" }, select: { id: true }, take: 1 },
  ...LATEST_RENEWAL_RECEIPT_INCLUDE,
} satisfies Prisma.PolicyInclude;

function ownerWhere(owner?: string): Prisma.PolicyWhereInput {
  if (!owner) return {};
  if (owner === UNASSIGNED_OWNER_VALUE) return { client: { portfolioOwnerId: null } };
  return { client: { portfolioOwnerId: owner } };
}

/**
 * Qué pólizas entran al tablero.
 *
 * La elegibilidad sigue siendo la de siempre (`ACTIVE_RENEWAL_POLICY_WHERE` más
 * `shouldIncludeInRenewals`); lo único que se agrega son las que ya salieron de
 * ella por haberse resuelto: renovadas de verdad, marcadas como no continuadas,
 * o movidas a una columna terminal del tablero. Sin eso, cerrar una renovación
 * la haría desaparecer en lugar de mostrarla en su columna.
 */
export function buildRenewalBoardWhere(
  filters: RenewalBoardFilters,
  portfolioOwnerId: string | undefined,
  organizationId: string,
  today: Date = businessToday(),
): Prisma.PolicyWhereInput {
  const range = renewalWindowRange(filters.window, today);

  return {
    AND: [
      { organizationId },
      portfolioOwnerId ? { client: { portfolioOwnerId } } : {},
      ownerWhere(filters.owner),
      { endDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } },
      {
        OR: [
          ACTIVE_RENEWAL_POLICY_WHERE,
          { status: "RENEWED" },
          { renewalStage: { in: ["WON", "LOST"] } },
          { sourceRenewalSuggestions: { some: { status: "DECLINED" } } },
        ],
      },
    ],
  };
}

type RenewalBoardPolicy = Prisma.PolicyGetPayload<{ include: typeof renewalBoardInclude }>;

/**
 * Convierte una póliza en tarjeta. Devuelve `null` cuando la póliza ya no es
 * elegible para renovación y tampoco está en una etapa terminal, es decir,
 * cuando no tiene nada que hacer en el tablero.
 */
function toRenewalBoardCard(policy: RenewalBoardPolicy, today: Date): RenewalBoardCard | null {
  const hasDeclinedSuggestion = policy.sourceRenewalSuggestions.length > 0;
  const stage = resolveRenewalStage({
    policyStatus: policy.status,
    renewalStage: policy.renewalStage,
    hasDeclinedSuggestion,
  });

  const eligible = shouldIncludeInRenewals(
    policy.status,
    policy.endDate,
    getLatestReceiptStatus(policy.receipts),
  );
  if (!eligible && !isTerminalRenewalStage(stage)) return null;

  const daysUntilRenewal = daysBetweenBusinessDates(policy.endDate, today);

  return {
    organizationId: policy.organizationId!,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    clientId: policy.clientId,
    clientName: policy.client.fullName,
    insurerId: policy.insurerId,
    insurerName: policy.insurer.name,
    endDate: policy.endDate,
    daysUntilRenewal,
    premiumAmount: Number(policy.premiumAmount),
    currency: policy.currency,
    priority: calculateRenewalPriority(policy.endDate, today),
    stage,
    stageChangedAt: policy.renewalStageAt,
    ownerId: policy.client.portfolioOwnerId,
    ownerName: policy.client.portfolioOwner?.name ?? null,
    stall: getRenewalStallState({
      stage,
      stageChangedAt: policy.renewalStageAt,
      daysUntilRenewal,
      today,
    }),
    canCapture: policy.status !== "RENEWED" && policy.renewals.length === 0,
    renewedToPolicyId: policy.renewals[0]?.id ?? null,
  };
}

export async function loadRenewalBoard(
  filters: RenewalBoardFilters,
  portfolioOwnerId: string | undefined,
  organizationId: string,
): Promise<RenewalBoardData> {
  const today = businessToday();

  try {
    const db = getDb();
    const policies = await db.policy.findMany({
      where: buildRenewalBoardWhere(filters, portfolioOwnerId, organizationId, today),
      include: renewalBoardInclude,
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: RENEWAL_BOARD_LIMIT + 1,
    });

    const truncated = policies.length > RENEWAL_BOARD_LIMIT;
    const cards: RenewalBoardCard[] = [];

    for (const policy of policies.slice(0, RENEWAL_BOARD_LIMIT)) {
      const card = toRenewalBoardCard(policy, today);
      if (card) cards.push(card);
    }

    const columns: RenewalBoardColumn[] = RENEWAL_STAGES.map((stage) => {
      const stageCards = cards.filter((card) => card.stage === stage);
      const currencies = new Set(stageCards.map((card) => card.currency));
      return {
        stage,
        count: stageCards.length,
        cards: stageCards.slice(0, RENEWAL_BOARD_COLUMN_PREVIEW),
        premiumTotal: stageCards.reduce((sum, card) => sum + card.premiumAmount, 0),
        premiumTotalCurrency: currencies.size === 1 ? [...currencies][0] : null,
      };
    });

    return {
      columns,
      cards,
      total: cards.length,
      stalledCount: cards.filter((card) => card.stall.stalled).length,
      truncated,
    };
  } catch (error) {
    logError("renewal-board.loadRenewalBoard", error, { window: filters.window });
    return {
      columns: RENEWAL_STAGES.map((stage) => ({
        stage,
        count: 0,
        cards: [],
        premiumTotal: 0,
        premiumTotalCurrency: null,
      })),
      cards: [],
      total: 0,
      stalledCount: 0,
      truncated: false,
    };
  }
}

/** Cuántas pólizas trae cada página del barrido de seguimiento. */
export const RENEWAL_SCAN_PAGE_SIZE = 200;

/**
 * Recorre **todas** las renovaciones vivas, sin ventana de vencimiento y sin el
 * tope del tablero.
 *
 * El tablero se acota a lo que cabe en una pantalla; un barrido de fondo no
 * puede hacerlo, porque quedarse en una ventana dejaría fuera justo las
 * renovaciones que nadie está mirando: las vencidas hace mucho y las que se
 * estancaron con el vencimiento todavía lejos. Sólo se piden las elegibles
 * (`ACTIVE_RENEWAL_POLICY_WHERE`), ya que una renovación resuelta —renovada,
 * declinada o movida a una columna terminal— nunca está estancada.
 *
 * Se pagina con cursor para no cargar la cartera entera en memoria.
 */
export async function forEachRenewalCandidate(
  organizationId: string,
  handle: (card: RenewalBoardCard) => Promise<void>,
  today: Date = businessToday(),
): Promise<{ scanned: number }> {
  const db = getDb();
  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const policies = await db.policy.findMany({
      where: { ...ACTIVE_RENEWAL_POLICY_WHERE, organizationId },
      include: renewalBoardInclude,
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: RENEWAL_SCAN_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (policies.length === 0) break;

    for (const policy of policies) {
      const card = toRenewalBoardCard(policy, today);
      if (!card || isTerminalRenewalStage(card.stage)) continue;
      scanned += 1;
      await handle(card);
    }

    if (policies.length < RENEWAL_SCAN_PAGE_SIZE) break;
    cursor = policies[policies.length - 1].id;
  }

  return { scanned };
}

/**
 * Responsables que pueden aparecer en el filtro. Un agente sólo se ve a sí
 * mismo porque su alcance de cartera ya lo limita antes de llegar aquí.
 */
export async function getRenewalBoardOwners(portfolioOwnerId: string | undefined, organizationId: string) {
  try {
    const db = getDb();
    const users = await db.user.findMany({
      where: {
        active: true,
        ...(portfolioOwnerId ? { id: portfolioOwnerId } : {}),
        organizationMemberships: { some: { organizationId, active: true } },
        portfolioClients: { some: { organizationId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return users;
  } catch (error) {
    logError("renewal-board.getRenewalBoardOwners", error);
    return [];
  }
}
