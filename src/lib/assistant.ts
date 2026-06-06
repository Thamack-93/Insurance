import "server-only";

import { addDays } from "date-fns";
import { getDb } from "@/lib/db";
import { detectRisks } from "@/lib/risk-engine";
import { globalSearch } from "@/lib/search";
import { getUpcomingRenewals } from "@/lib/renewals";
import { formatCurrency } from "@/lib/money";
import { formatDate, today } from "@/lib/dates";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import {
  assertClientPortfolioAccess,
  assertPolicyPortfolioAccess,
  clientPortfolioWhere,
  receiptPortfolioWhere,
} from "@/lib/portfolio-access";
import type {
  AssistantPrompt,
  AssistantReply,
  AssistantSection,
  AssistantSnapshot,
  AssistantTodayBrief,
  AssistantUser,
} from "@/lib/assistant-types";

function getScopeUserId(user: AssistantUser) {
  return user.role === "ADMIN" ? undefined : user.id;
}

function normalizeMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function extractDays(message: string, fallback = 30) {
  const match = message.match(/\b(\d{1,3})\b/);
  if (!match) return fallback;
  const next = Number(match[1]);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, 1), 365);
}

function extractTargetText(message: string, keywords: string[]) {
  const pattern = new RegExp(`^(?:\\/)?(?:buscar\\s+)?(?:${keywords.join("|")})(?:\\s*[:\\-])?\\s*`, "i");
  return message.replace(pattern, "").trim();
}

function buildOverviewPrompts(): AssistantPrompt[] {
  return [
    { label: "Resumen de hoy", prompt: "hoy" },
    { label: "Renovaciones 30 días", prompt: "renovaciones 30" },
    { label: "Recibos vencidos", prompt: "recibos vencidos" },
    { label: "Riesgos", prompt: "riesgos" },
    { label: "Buscar cliente", prompt: "buscar cliente" },
  ];
}

async function getTodayBrief(user: AssistantUser): Promise<AssistantTodayBrief> {
  const db = getDb();
  const portfolioOwnerId = getScopeUserId(user);
  const now = today();
  const tomorrow = addDays(now, 1);
  const in7 = addDays(now, 7);
  const receiptWhere = portfolioOwnerId ? receiptPortfolioWhere(portfolioOwnerId) : {};
  const renewalsPromise = getUpcomingRenewals(30, portfolioOwnerId);

  const [
    dueTodayCount,
    overdueCount,
    due7Count,
    renewals30,
    openWorkItemsCount,
    commissionsCount,
    dueTodayReceipts,
    overdueReceipts,
    openWorkItems,
  ] = await Promise.all([
    db.receipt.count({
      where: { ...receiptWhere, dueDate: { gte: now, lt: tomorrow }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    db.receipt.count({
      where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    db.receipt.count({
      where: { ...receiptWhere, dueDate: { gte: tomorrow, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    renewalsPromise,
    db.workItem.count({
      where: {
        ...(portfolioOwnerId
          ? {
              OR: [
                { client: clientPortfolioWhere(portfolioOwnerId) },
                { clientId: null, assignedToId: portfolioOwnerId },
              ],
            }
          : {}),
        status: { in: [...OPEN_WORK_ITEM_STATUSES] },
      },
    }),
    db.commission.count({
      where: {
        ...(portfolioOwnerId ? { client: clientPortfolioWhere(portfolioOwnerId) } : {}),
        status: { in: ["EXPECTED", "PENDING", "OVERDUE"] },
      },
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: now, lt: tomorrow }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    renewalsPromise,
    getWorkItems({
      portfolioOwnerId,
      statuses: OPEN_WORK_ITEM_STATUSES,
      limit: 5,
    }),
  ]);

  return {
    title: "Resumen de hoy",
    summary:
      `Tienes ${overdueCount} recibos vencidos, ${dueTodayCount} recibos de hoy, ${due7Count} recibos para los próximos 7 días, ${renewals30.length} renovaciones en 30 días, ${openWorkItemsCount} pendientes abiertos y ${commissionsCount} comisiones por revisar.`,
    metrics: {
      dueTodayCount,
      overdueCount,
      due7Count,
      renewals30Count: renewals30.length,
      openWorkItemsCount,
      commissionsCount,
    },
    items: [
      ...overdueReceipts.map((receipt) => ({
        title: `${receipt.client.fullName} · ${receipt.receiptNumber}`,
        subtitle: `${receipt.policy.policyNumber} · ${receipt.insurer.name} · vence ${formatDate(receipt.dueDate)}`,
        href: `/receipts/${receipt.id}`,
        meta: formatCurrency(receipt.amount, receipt.currency),
      })),
      ...dueTodayReceipts.map((receipt) => ({
        title: `${receipt.client.fullName} · ${receipt.receiptNumber}`,
        subtitle: `${receipt.policy.policyNumber} · ${receipt.insurer.name} · vence hoy`,
        href: `/receipts/${receipt.id}`,
        meta: formatCurrency(receipt.amount, receipt.currency),
      })),
      ...renewals30.map((renewal) => ({
        title: `${renewal.policyNumber} · ${renewal.clientName}`,
        subtitle: `${renewal.insurerName} · vence ${formatDate(renewal.endDate)}`,
        href: `/policies/${renewal.policyId}`,
        meta: `${renewal.daysUntilRenewal} días`,
      })),
      ...openWorkItems.map((workItem) => ({
        title: workItem.title,
        subtitle: workItem.client?.fullName ?? workItem.folio ?? workItem.sourceId ?? "Pendiente sin cliente",
        href: `/tasks/${workItem.sourceId ?? workItem.id}`,
        meta: workItem.status,
      })),
    ],
  };
}

async function getRenewalBrief(user: AssistantUser, daysAhead: number): Promise<AssistantSection> {
  const portfolioOwnerId = getScopeUserId(user);
  const renewals = await getUpcomingRenewals(daysAhead, portfolioOwnerId);

  return {
    title: `Renovaciones ${daysAhead} días`,
    summary:
      renewals.length === 0
        ? "No encontré renovaciones en esa ventana."
        : `Encontré ${renewals.length} renovaciones dentro de los próximos ${daysAhead} días.`,
    items: renewals.slice(0, 8).map((renewal) => ({
      title: `${renewal.policyNumber} · ${renewal.clientName}`,
      subtitle: `${renewal.insurerName} · vence ${formatDate(renewal.endDate)}`,
      href: `/policies/${renewal.policyId}`,
      meta: `${renewal.daysUntilRenewal} días`,
    })),
  };
}

async function getRiskBrief(user: AssistantUser): Promise<AssistantSection> {
  const portfolioOwnerId = getScopeUserId(user);
  const risks = await detectRisks(portfolioOwnerId);
  const top = risks.slice(0, 8);

  return {
    title: "Riesgos",
    summary:
      risks.length === 0
        ? "No hay riesgos abiertos en este momento."
        : `Detecté ${risks.length} riesgos activos; te muestro los más importantes.`,
    items: top.map((risk) => ({
      title: risk.title,
      subtitle: `${risk.entityType} · ${risk.description}`,
      href:
        risk.entityType === "Client"
          ? `/clients/${risk.entityId}`
          : risk.entityType === "Policy"
            ? `/policies/${risk.entityId}`
            : risk.entityType === "Receipt"
              ? `/receipts/${risk.entityId}`
              : risk.entityType === "WorkItem"
                ? `/tasks/${risk.entityId}`
                : risk.entityType === "Document"
                  ? `/documents`
                  : "/reports",
      meta: risk.severity,
    })),
  };
}

async function getWorkBrief(user: AssistantUser): Promise<AssistantSection> {
  const portfolioOwnerId = getScopeUserId(user);
  const workItems = await getWorkItems({
    portfolioOwnerId,
    statuses: OPEN_WORK_ITEM_STATUSES,
    limit: 8,
  });

  return {
    title: "Pendientes abiertos",
    summary:
      workItems.length === 0
        ? "No hay pendientes abiertos."
        : `Encontré ${workItems.length} pendientes abiertos en tu alcance actual.`,
    items: workItems.map((workItem) => ({
      title: workItem.title,
      subtitle: `${workItem.client?.fullName ?? "Sin cliente"} · ${workItem.status}`,
      href: `/tasks/${workItem.sourceId ?? workItem.id}`,
      meta: workItem.priority,
    })),
  };
}

async function getOverdueReceiptBrief(user: AssistantUser, daysAhead: number): Promise<AssistantSection> {
  const db = getDb();
  const portfolioOwnerId = getScopeUserId(user);
  const now = today();
  const limitDate = addDays(now, daysAhead);
  const where = portfolioOwnerId ? receiptPortfolioWhere(portfolioOwnerId) : {};
  const receipts = await db.receipt.findMany({
    where: {
      ...where,
      dueDate: { lte: limitDate },
      status: { notIn: ["PAID", "CANCELLED"] },
    },
    include: { client: true, policy: true, insurer: true },
    orderBy: { dueDate: "asc" },
    take: 8,
  });

  return {
    title: `Recibos hasta ${daysAhead} días`,
    summary:
      receipts.length === 0
        ? "No encontré recibos vencidos o próximos dentro de la ventana pedida."
        : `Encontré ${receipts.length} recibos por revisar dentro de la ventana pedida.`,
    items: receipts.map((receipt) => ({
      title: `${receipt.client.fullName} · ${receipt.receiptNumber}`,
      subtitle: `${receipt.policy.policyNumber} · ${receipt.insurer.name} · vence ${formatDate(receipt.dueDate)}`,
      href: `/receipts/${receipt.id}`,
      meta: formatCurrency(receipt.amount, receipt.currency),
    })),
  };
}

async function searchClientsBrief(user: AssistantUser, query: string): Promise<AssistantSection> {
  const portfolioOwnerId = getScopeUserId(user);
  const results = await globalSearch(query, portfolioOwnerId);
  const clientResults = results.filter((result) => result.type === "client").slice(0, 8);

  return {
    title: "Búsqueda de clientes",
    summary:
      clientResults.length === 0
        ? `No encontré clientes para "${query}".`
        : `Encontré ${clientResults.length} clientes para "${query}".`,
    items: clientResults.map((result) => ({
      title: result.title,
      subtitle: result.subtitle ?? "Cliente",
      href: result.href,
      meta: result.match ? `Coincidencia en ${result.match.fieldLabel}` : undefined,
    })),
  };
}

async function getClientOverviewBrief(user: AssistantUser, query: string): Promise<AssistantSection> {
  const db = getDb();
  const portfolioOwnerId = getScopeUserId(user);
  const results = await globalSearch(query, portfolioOwnerId);
  const clientResult = results.find((result) => result.type === "client");

  if (!clientResult) {
    return {
      title: "Cliente",
      summary: `No encontré un cliente que coincida con "${query}".`,
      items: [],
    };
  }

  if (portfolioOwnerId) {
    await assertClientPortfolioAccess(clientResult.id, portfolioOwnerId);
  }

  const client = await db.client.findUnique({
    where: { id: clientResult.id },
    include: {
      _count: {
        select: {
          policies: true,
          receipts: true,
          workItems: true,
          claims: true,
          quotes: true,
        },
      },
    },
  });

  if (!client) {
    return {
      title: "Cliente",
      summary: `No pude cargar el cliente "${query}".`,
      items: [],
    };
  }

  const [policies, receipts, workItems] = await Promise.all([
    db.policy.findMany({
      where: {
        clientId: client.id,
        status: "ACTIVE",
      },
      include: { insurer: true },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      take: 5,
    }),
    db.receipt.findMany({
      where: { clientId: client.id, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    db.workItem.findMany({
      where: {
        OR: [{ clientId: client.id }, { clientId: null, assignedToId: client.portfolioOwnerId }],
        status: { in: [...OPEN_WORK_ITEM_STATUSES] },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 5,
    }),
  ]);

  return {
    title: `Cliente · ${client.fullName}`,
    summary: `Tiene ${client._count.policies} pólizas, ${client._count.receipts} recibos, ${client._count.workItems} pendientes abiertos, ${client._count.claims} siniestros y ${client._count.quotes} cotizaciones.`,
    items: [
      ...policies.map((policy) => ({
        title: policy.policyNumber,
        subtitle: `${policy.insurer.name} · ${policy.policyType} · vence ${formatDate(policy.endDate)}`,
        href: `/policies/${policy.id}`,
        meta: policy.status,
      })),
      ...receipts.map((receipt) => ({
        title: receipt.receiptNumber,
        subtitle: `${receipt.policy.policyNumber} · ${receipt.insurer.name} · vence ${formatDate(receipt.dueDate)}`,
        href: `/receipts/${receipt.id}`,
        meta: receipt.status,
      })),
      ...workItems.map((workItem) => ({
        title: workItem.title,
        subtitle: workItem.folio ?? workItem.sourceId ?? "Pendiente",
        href: `/tasks/${workItem.sourceId ?? workItem.id}`,
        meta: workItem.status,
      })),
    ],
  };
}

async function getPolicyOverviewBrief(user: AssistantUser, query: string): Promise<AssistantSection> {
  const db = getDb();
  const portfolioOwnerId = getScopeUserId(user);
  const results = await globalSearch(query, portfolioOwnerId);
  const policyResult = results.find((result) => result.type === "policy");

  if (!policyResult) {
    return {
      title: "Póliza",
      summary: `No encontré una póliza que coincida con "${query}".`,
      items: [],
    };
  }

  if (portfolioOwnerId) {
    await assertPolicyPortfolioAccess(policyResult.id, portfolioOwnerId);
  }

  const policy = await db.policy.findUnique({
    where: { id: policyResult.id },
    include: {
      client: true,
      insurer: true,
      _count: {
        select: {
          receipts: true,
          workItems: true,
          documents: true,
        },
      },
    },
  });

  if (!policy) {
    return {
      title: "Póliza",
      summary: `No pude cargar la póliza "${query}".`,
      items: [],
    };
  }

  const [receipts, workItems] = await Promise.all([
    db.receipt.findMany({
      where: { policyId: policy.id, status: { notIn: ["CANCELLED"] } },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    db.workItem.findMany({
      where: {
        OR: [{ policyId: policy.id }, { clientId: null, assignedToId: policy.client.portfolioOwnerId }],
        status: { in: [...OPEN_WORK_ITEM_STATUSES] },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 5,
    }),
  ]);

  return {
    title: `Póliza · ${policy.policyNumber}`,
    summary: `${policy.client.fullName} · ${policy.insurer.name} · vence ${formatDate(policy.endDate)} · ${policy._count.receipts} recibos, ${policy._count.workItems} pendientes y ${policy._count.documents} documentos.`,
    items: [
      ...receipts.map((receipt) => ({
        title: receipt.receiptNumber,
        subtitle: `${receipt.status} · vence ${formatDate(receipt.dueDate)}`,
        href: `/receipts/${receipt.id}`,
        meta: formatCurrency(receipt.amount, receipt.currency),
      })),
      ...workItems.map((workItem) => ({
        title: workItem.title,
        subtitle: workItem.folio ?? workItem.sourceId ?? "Pendiente",
        href: `/tasks/${workItem.sourceId ?? workItem.id}`,
        meta: workItem.status,
      })),
    ],
  };
}

async function getGlobalSearchBrief(user: AssistantUser, query: string): Promise<AssistantSection> {
  const portfolioOwnerId = getScopeUserId(user);
  const results = await globalSearch(query, portfolioOwnerId);

  return {
    title: "Búsqueda global",
    summary:
      results.length === 0
        ? `No encontré resultados para "${query}".`
        : `Encontré ${results.length} resultados para "${query}".`,
    items: results.slice(0, 8).map((result) => ({
      title: result.title,
      subtitle: result.subtitle ?? result.parentLabel ?? result.type,
      href: result.href,
      meta: result.type,
    })),
  };
}

export async function getAssistantHomeSnapshot(user: AssistantUser): Promise<AssistantSnapshot> {
  const todayBrief = await getTodayBrief(user);
  const renewals = await getRenewalBrief(user, 14);
  const risks = await getRiskBrief(user);
  const workItems = await getWorkBrief(user);

  const summaryCards = [
    { label: "Vencidos", value: String(todayBrief.metrics.overdueCount), description: "Recibos atrasados", href: "/receipts?tab=cobrar" },
    { label: "Hoy", value: String(todayBrief.metrics.dueTodayCount), description: "Recibos del día", href: "/today" },
    { label: "Renovaciones", value: String(todayBrief.metrics.renewals30Count), description: "Próximas 30 días", href: "/renewals" },
    { label: "Pendientes", value: String(todayBrief.metrics.openWorkItemsCount), description: "Abiertos", href: "/tasks" },
  ];

  const scopeLabel = user.role === "ADMIN" ? "Cartera global" : "Tu cartera";
  const welcome =
    user.role === "ADMIN"
      ? "Puedo resumir la operación global, buscar clientes, revisar pólizas y abrir el contexto de riesgos sin escribir nada."
      : "Puedo resumir tu cartera, buscar clientes y pólizas, y abrir el contexto de riesgos sin escribir nada.";

  return {
    scopeLabel,
    welcome,
    summaryCards,
    quickPrompts: buildOverviewPrompts(),
    sections: [renewals, workItems, risks],
  };
}

export async function buildAssistantReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);

  if (!normalized || ["hola", "buenos dias", "buenas", "help", "ayuda", "menu"].includes(normalized)) {
    const home = await getAssistantHomeSnapshot(user);
    return {
      reply: home.welcome,
      sections: home.sections,
      quickPrompts: home.quickPrompts,
    };
  }

  if (normalized.includes("renov")) {
    const daysAhead = extractDays(normalized, 30);
    const section = await getRenewalBrief(user, daysAhead);
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("hoy") || normalized.includes("today")) {
    const section = await getTodayBrief(user);
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("riesg")) {
    const section = await getRiskBrief(user);
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("pendient") || normalized.includes("tarea") || normalized.includes("task")) {
    const section = await getWorkBrief(user);
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("recibo") || normalized.includes("cobro") || normalized.includes("pago")) {
    const daysAhead = extractDays(normalized, 30);
    const section = await getOverdueReceiptBrief(user, daysAhead);
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("cliente")) {
    const query = extractTargetText(message, ["cliente", "clientes"]);
    const target = query || message.trim();
    if (!target || ["cliente", "clientes", "buscar cliente", "buscar clientes"].includes(normalizeMessage(target))) {
      return {
        reply: "Dime el nombre, correo, RFC o número de cliente y te muestro su contexto.",
        sections: [
          {
            title: "Cliente",
            summary: "Necesito un nombre o identificador para buscarlo.",
            items: [],
          },
        ],
        quickPrompts: buildOverviewPrompts(),
      };
    }
    const section = await searchClientsBrief(user, target);
    if (section.items.length === 1) {
      const overview = await getClientOverviewBrief(user, section.items[0].title);
      return {
        reply: overview.summary,
        sections: [overview],
        quickPrompts: buildOverviewPrompts(),
      };
    }
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  if (normalized.includes("poliza")) {
    const query = extractTargetText(message, ["poliza", "póliza", "polizas", "pólizas"]);
    const target = query || message.trim();
    if (!target || ["poliza", "póliza", "polizas", "pólizas", "buscar poliza", "buscar póliza"].includes(normalizeMessage(target))) {
      return {
        reply: "Dime el número de póliza, cliente o aseguradora y te muestro su contexto.",
        sections: [
          {
            title: "Póliza",
            summary: "Necesito un número o identificador para buscarla.",
            items: [],
          },
        ],
        quickPrompts: buildOverviewPrompts(),
      };
    }
    const section = await getGlobalSearchBrief(user, target);
    const policyCount = section.items.filter((item) => item.meta === "policy").length;
    if (policyCount === 1) {
      const policyItem = section.items.find((item) => item.meta === "policy");
      if (policyItem) {
        const overview = await getPolicyOverviewBrief(user, policyItem.title);
        return {
          reply: overview.summary,
          sections: [overview],
          quickPrompts: buildOverviewPrompts(),
        };
      }
    }
    return {
      reply: section.summary,
      sections: [section],
      quickPrompts: buildOverviewPrompts(),
    };
  }

  const section = await getGlobalSearchBrief(user, message.trim());
  return {
    reply:
      section.items.length > 0
        ? section.summary
        : "No identifiqué una consulta específica. Prueba con hoy, renovaciones, recibos, riesgos o busca un cliente/póliza.",
    sections: [section],
    quickPrompts: buildOverviewPrompts(),
  };
}
