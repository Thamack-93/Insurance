import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
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
  renewalManualFollowUpWorkItemSourceId,
  type RenewalBoardFilters,
  type RenewalStallState,
} from "@/lib/renewal-board.logic";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { withSystemOrganizationTransaction } from "@/lib/organization-context";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { policyObjectSearchTerms } from "@/lib/policy-identity";

/**
 * Máximo de pólizas que el tablero carga de una sola vez. Con la ventana más
 * amplia (90 días) una cartera real cabe de sobra; el corte existe para que un
 * catálogo inflado no tumbe la página, y la vista avisa cuando lo alcanza.
 */
export const RENEWAL_BOARD_LIMIT = 400;

export type RenewalBoardCard = {
  organizationId: string;
  policyId: string;
  policyNumber: string;
  policyType: string;
  insuredObject: string | null;
  insuredAssets: Array<{ description: string; isPrimary: boolean }>;
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
  serialRenewalSuggestions: Array<{
    id: string;
    targetPolicyId: string;
    targetPolicyNumber: string;
    targetInsurerName: string;
    targetStartDate: Date;
    targetSerialNumbers: string[];
    confidence: number | null;
    reason: string | null;
  }>;
  manualFollowUp?: {
    id: string;
    dueDate: Date;
    notes: string | null;
  } | null;
};

export type RenewalBoardColumn = {
  stage: RenewalStage;
  count: number;
  cards: RenewalBoardCard[];
  premiumTotal: number;
  /** `null` cuando la columna mezcla monedas y el total no se puede sumar. */
  premiumTotalCurrency: string | null;
};

export type RenewalBoardExcludedPolicy = {
  policyId: string;
  policyNumber: string;
  insuredObject: string | null;
  insuredAssets: Array<{ description: string; isPrimary: boolean }>;
  clientId: string;
  clientName: string;
  insurerName: string;
  status: string;
  endDate: Date;
  latestReceiptStatus: string | null;
  reason: "OUTSIDE_WINDOW" | "INACTIVE" | "CANCELLED_RECEIPT" | "NOT_ELIGIBLE";
};

export type RenewalBoardData = {
  columns: RenewalBoardColumn[];
  /** Todas las tarjetas del tablero, sin recortar por columna. */
  cards: RenewalBoardCard[];
  total: number;
  stalledCount: number;
  truncated: boolean;
  /** Registros relacionados con la búsqueda que no son accionables en esta ventana. */
  excludedPolicies: RenewalBoardExcludedPolicy[];
  error?: string;
};

const renewalBoardBaseInclude = {
  client: {
    select: { id: true, fullName: true, portfolioOwnerId: true, portfolioOwner: { select: { name: true } } },
  },
  insurer: { select: { name: true } },
  renewals: { select: { id: true }, orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1 },
  sourceRenewalSuggestions: {
    where: {
      OR: [
        { status: "DECLINED" },
        { status: "PENDING", reason: { startsWith: "Misma serie/VIN" } },
      ],
    },
    select: {
      id: true,
      status: true,
      confidence: true,
      reason: true,
      targetPolicy: {
        select: {
          id: true,
          policyNumber: true,
          startDate: true,
          insurer: { select: { name: true } },
          insuredAssets: { select: { serialNumber: true } },
        },
      },
    },
  },
  ...LATEST_RENEWAL_RECEIPT_INCLUDE,
} satisfies Prisma.PolicyInclude;

const renewalBoardInclude = {
  ...renewalBoardBaseInclude,
  insuredAssets: {
    select: { description: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.PolicyInclude;

function ownerWhere(owner?: string): Prisma.PolicyWhereInput {
  if (!owner) return {};
  if (owner === UNASSIGNED_OWNER_VALUE) return { client: { portfolioOwnerId: null } };
  return { client: { portfolioOwnerId: owner } };
}

function searchWhere(query?: string): Prisma.PolicyWhereInput {
  if (!query) return {};
  return {
    OR: [
      { policyNumber: { contains: query } },
      { client: { fullName: { contains: query } } },
      { insurer: { name: { contains: query } } },
      ...policyObjectSearchTerms(query),
    ],
  };
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
      searchWhere(filters.query),
      { endDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } },
      {
        OR: [
          ACTIVE_RENEWAL_POLICY_WHERE,
          { status: "RENEWED" },
          { renewalStage: { in: ["WON", "LOST"] } },
          { sourceRenewalSuggestions: { some: { OR: [
            { status: "DECLINED" },
            { status: "PENDING", reason: { startsWith: "Misma serie/VIN" } },
          ] } } },
        ],
      },
    ],
  };
}

type RenewalBoardPolicy = Prisma.PolicyGetPayload<{ include: typeof renewalBoardBaseInclude }>;

/**
 * Convierte una póliza en tarjeta. Devuelve `null` cuando la póliza ya no es
 * elegible para renovación y tampoco está en una etapa terminal, es decir,
 * cuando no tiene nada que hacer en el tablero.
 */
function toRenewalBoardCard(policy: RenewalBoardPolicy, today: Date): RenewalBoardCard | null {
  const pendingSuggestions = policy.sourceRenewalSuggestions.flatMap((suggestion) =>
    suggestion.status === "PENDING" && suggestion.reason?.startsWith("Misma serie/VIN") && suggestion.targetPolicy
      ? [{
          id: suggestion.id,
          targetPolicyId: suggestion.targetPolicy.id,
          targetPolicyNumber: suggestion.targetPolicy.policyNumber,
          targetInsurerName: suggestion.targetPolicy.insurer.name,
          targetStartDate: suggestion.targetPolicy.startDate,
          targetSerialNumbers: suggestion.targetPolicy.insuredAssets.map((asset) => asset.serialNumber).filter((value): value is string => Boolean(value)),
          confidence: suggestion.confidence === null ? null : Number(suggestion.confidence),
          reason: suggestion.reason,
        }]
      : [],
  );
  const hasDeclinedSuggestion = policy.sourceRenewalSuggestions.some((suggestion) => suggestion.status === "DECLINED");
  const stage = resolveRenewalStage({
    policyStatus: policy.status,
    renewalStage: policy.renewalStage,
    hasDeclinedSuggestion,
  });

  const eligible = shouldIncludeInRenewals(
    policy.status,
    policy.endDate,
    getLatestReceiptStatus(policy.receipts),
  ) || pendingSuggestions.length > 0;
  if (!eligible && !isTerminalRenewalStage(stage)) return null;

  const daysUntilRenewal = daysBetweenBusinessDates(policy.endDate, today);
  const insuredAssets = (policy as RenewalBoardPolicy & {
    insuredAssets?: Array<{ description: string; isPrimary: boolean }>;
  }).insuredAssets ?? [];

  return {
    organizationId: policy.organizationId!,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    insuredObject: policy.insuredObject,
    insuredAssets,
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
    serialRenewalSuggestions: pendingSuggestions,
  };
}

export async function loadRenewalBoard(
  filters: RenewalBoardFilters,
  portfolioOwnerId: string | undefined,
  organizationId: string,
): Promise<RenewalBoardData> {
  const today = businessToday();

  try {
    const { policies, manualFollowUps, relatedPolicies } = await withTenantOrganization(organizationId, async (db) => {
      const policies = await db.policy.findMany({
        where: buildRenewalBoardWhere(filters, portfolioOwnerId, organizationId, today),
        include: renewalBoardInclude,
        orderBy: [{ endDate: "asc" }, { id: "asc" }],
        take: RENEWAL_BOARD_LIMIT + 1,
      });

      const relatedPolicies = filters.query
        ? await db.policy.findMany({
            where: {
              AND: [
                { organizationId },
                portfolioOwnerId ? { client: { portfolioOwnerId } } : {},
                ownerWhere(filters.owner),
                searchWhere(filters.query),
              ],
            },
            include: renewalBoardInclude,
            orderBy: [{ endDate: "asc" }, { id: "asc" }],
            take: 200,
          })
        : [];

      const visiblePolicyIds = policies.slice(0, RENEWAL_BOARD_LIMIT).map((policy) => policy.id);
      const manualFollowUps = visiblePolicyIds.length
        ? await db.workItem.findMany({
            where: {
              organizationId,
              sourceType: "Renewal",
              sourceId: { in: visiblePolicyIds.map(renewalManualFollowUpWorkItemSourceId) },
              status: { in: [...OPEN_WORK_ITEM_STATUSES] },
              dueDate: { not: null },
            },
            select: { id: true, sourceId: true, dueDate: true, notes: true },
          })
        : [];

      return { policies, manualFollowUps, relatedPolicies };
    });

    const manualPolicyIdBySourceId = new Map(
      policies.slice(0, RENEWAL_BOARD_LIMIT).map((policy) => [renewalManualFollowUpWorkItemSourceId(policy.id), policy.id] as const),
    );
    const manualFollowUpByPolicyId = new Map(
      manualFollowUps.flatMap((item) => {
        const policyId = manualPolicyIdBySourceId.get(item.sourceId ?? "");
        return policyId && item.dueDate ? [[policyId, { id: item.id, dueDate: item.dueDate, notes: item.notes }] as const] : [];
      }),
    );

    const truncated = policies.length > RENEWAL_BOARD_LIMIT;
    const cards: RenewalBoardCard[] = [];

    for (const policy of policies.slice(0, RENEWAL_BOARD_LIMIT)) {
      const card = toRenewalBoardCard(policy, today);
      if (card) cards.push({ ...card, manualFollowUp: manualFollowUpByPolicyId.get(card.policyId) ?? null });
    }

    const cardIds = new Set(cards.map((card) => card.policyId));
    const range = renewalWindowRange(filters.window, today);
    // The related query is intentionally kept separate from the actionable
    // window query. This makes a search useful for diagnosis without turning
    // future, cancelled or otherwise ineligible policies into work items.
    const diagnosticPolicies: RenewalBoardExcludedPolicy[] = relatedPolicies.flatMap((policy) => {
      if (cardIds.has(policy.id)) return [];
      const latestReceiptStatus = getLatestReceiptStatus(policy.receipts);
      const inWindow = (!range.from || policy.endDate >= range.from) && (!range.to || policy.endDate <= range.to);
      const reason: RenewalBoardExcludedPolicy["reason"] = policy.status !== "ACTIVE"
        ? "INACTIVE"
        : latestReceiptStatus === "CANCELLED"
          ? "CANCELLED_RECEIPT"
          : !inWindow
            ? "OUTSIDE_WINDOW"
            : "NOT_ELIGIBLE";
      return [{
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        insuredObject: policy.insuredObject,
        insuredAssets: policy.insuredAssets,
        clientId: policy.clientId,
        clientName: policy.client.fullName,
        insurerName: policy.insurer.name,
        status: policy.status,
        endDate: policy.endDate,
        latestReceiptStatus,
        reason,
      }];
    });

    const columns: RenewalBoardColumn[] = RENEWAL_STAGES.map((stage) => {
      const stageCards = cards.filter((card) => card.stage === stage);
      const currencies = new Set(stageCards.map((card) => card.currency));
      return {
        stage,
        count: stageCards.length,
        // Keep every loaded card reachable. The loader still caps pathological
        // datasets and advertises that cap separately; a second per-column
        // preview cap made valid renewals impossible to discover.
        cards: stageCards,
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
      excludedPolicies: diagnosticPolicies,
    };
  } catch (error) {
    logError("renewal-board.loadRenewalBoard", error, { errorCode: "RENEWAL_BOARD_LOAD_FAILED", window: filters.window });
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
      excludedPolicies: [],
      error: "RENEWAL_BOARD_LOAD_FAILED",
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
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<{ scanned: number }> {
  if (!client) {
    return withSystemOrganizationTransaction(organizationId, "renewal follow-up", (tx) =>
      forEachRenewalCandidate(organizationId, handle, today, tx),
    );
  }
  const db = client;
  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const policies = await db.policy.findMany({
      where: { ...ACTIVE_RENEWAL_POLICY_WHERE, organizationId },
      include: renewalBoardBaseInclude,
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
    const users = await withTenantOrganization(organizationId, (db) => db.user.findMany({
      where: {
        active: true,
        ...(portfolioOwnerId ? { id: portfolioOwnerId } : {}),
        organizationMemberships: { some: { organizationId, active: true } },
        portfolioClients: { some: { organizationId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }));
    return users;
  } catch (error) {
    logError("renewal-board.getRenewalBoardOwners", error);
    return [];
  }
}
