import "server-only";

import type { AssistantPrompt, AssistantReply, AssistantSection, AssistantSnapshot, AssistantUser } from "@/lib/assistant-types";
import { getTodayData } from "@/lib/dashboard-queries";
import { daysUntil } from "@/lib/dates";
import { globalSearch, type GlobalSearchResult } from "@/lib/search";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";

function normalizeMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function makeSection(title: string, summary: string, items: AssistantSection["items"]): AssistantSection {
  return { title, summary, items };
}

function buildQuickPrompts(): AssistantPrompt[] {
  return [
    { label: "Resumen de hoy", prompt: "hoy" },
    { label: "Renovaciones 30 días", prompt: "renovaciones 30" },
    { label: "Recibos vencidos", prompt: "recibos vencidos" },
    { label: "Buscar cliente", prompt: "buscar cliente" },
  ];
}

function buildTodaySectionItems<T extends { id: string }>(
  rows: T[],
  mapRow: (row: T) => AssistantSection["items"][number] | null,
) {
  return rows.slice(0, 4).map(mapRow).filter(Boolean) as AssistantSection["items"];
}

function extractPolicyNumber(normalized: string) {
  const match = normalized.match(/\b\d{5,}\b/);
  return match?.[0] ?? null;
}

function extractRenewalWindowDays(normalized: string) {
  const explicit = normalized.match(/\b(\d{1,3})\s*(?:dias?|days?)\b/);
  if (explicit) return Number(explicit[1]);

  const afterRenewals = normalized.match(/\brenov(?:acion(?:es)?)?(?:\s+(?:a|en|de|por))?\s*(\d{1,3})\b/);
  if (afterRenewals) return Number(afterRenewals[1]);

  return null;
}

function buildRenewalSectionItems(days: number, todayData: Awaited<ReturnType<typeof getTodayData>>) {
  return todayData.urgentRenewals
    .filter((policy) => {
      const distance = daysUntil(policy.endDate);
      return distance >= 0 && distance <= days;
    })
    .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate))
    .slice(0, 6)
    .map((policy) => ({
      title: policy.policyNumber,
      subtitle: `${policy.client.fullName} · Vence ${policy.endDate.toISOString().slice(0, 10)}`,
      href: `/policies/${policy.id}`,
      meta: `${daysUntil(policy.endDate)} días`,
    }));
}

async function buildRenewalsReply(days: number): Promise<AssistantReply> {
  const todayData = await getTodayData();
  const renewals = buildRenewalSectionItems(days, todayData);
  const dueSoonCount = renewals.length;
  const overdueCount = todayData.urgentRenewals.filter((policy) => daysUntil(policy.endDate) < 0).length;
  const reply =
    days === 30
      ? `Tienes ${dueSoonCount} renovación${dueSoonCount === 1 ? "" : "es"} dentro de los próximos 30 días${overdueCount > 0 ? ` y ${overdueCount} vencida${overdueCount === 1 ? "" : "s"}` : ""}.`
      : `Tienes ${dueSoonCount} renovación${dueSoonCount === 1 ? "" : "es"} dentro de los próximos ${days} días${overdueCount > 0 ? ` y ${overdueCount} vencida${overdueCount === 1 ? "" : "s"}` : ""}.`;

  return {
    reply,
    sections: [
      makeSection(
        `Renovaciones en ${days} días`,
        "Pólizas que vencen dentro del periodo solicitado.",
        renewals.length > 0
          ? renewals
          : [{ title: "Sin renovaciones en este rango", subtitle: "Prueba con 30 días o abre Renovaciones.", href: "/renewals", meta: "ok" }],
      ),
    ],
    quickPrompts: buildQuickPrompts(),
  };
}

async function buildPolicyChangeReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);
  const policyNumber = extractPolicyNumber(normalized);
  const searchQuery = policyNumber ?? message;
  const results = await searchUserPortfolio(user, searchQuery);
  const policyResults = results.filter((result) => result.href.startsWith("/policies/"));
  const target = policyResults[0] ?? null;
  const targetLabel = target?.title ?? policyNumber ?? "la póliza";

  return {
    reply: target
      ? `Encontré ${targetLabel}. Dime la nueva fecha de vencimiento y te preparo la edición.`
      : policyNumber
        ? `No encontré la póliza ${policyNumber} dentro de tu cartera. Si quieres, dime la nueva fecha y revisamos si el número está incompleto o si la póliza está fuera de tu alcance.`
        : "Puedo cambiar la fecha de vencimiento de una póliza. Dime el número exacto y la nueva fecha, y te preparo la edición.",
    sections: [
      makeSection(
        "Cambiar vencimiento",
        target ? "La póliza objetivo está identificada, falta confirmar la nueva fecha." : "Necesito identificar la póliza exacta para continuar.",
        target
          ? [
              {
                title: target.title,
                subtitle: target.subtitle ?? "Abrir póliza para editar vencimiento",
                href: target.href,
                meta: "editar",
              },
            ]
          : [
              {
                title: "Abrir búsqueda de póliza",
                subtitle: "Busca por número, cliente, RFC o aseguradora.",
                href: "/policies",
                meta: "buscar",
              },
            ],
      ),
    ],
    quickPrompts: [
      { label: "Cambiar vencimiento", prompt: "Cambiar fecha de vencimiento de la póliza" },
      { label: "Buscar póliza", prompt: "Buscar póliza" },
      { label: "Ver renovaciones", prompt: "Renovaciones próximas" },
    ],
  };
}

function buildHomeSections(user: AssistantUser): AssistantSection[] {
  const accessLabel = user.role === "ADMIN" ? "Vista administrativa" : "Vista operativa";

  return [
    makeSection(
      "Puntos de partida",
      "Atajos para consultar lo más útil sin salir del contexto.",
      [
        { title: "Renovaciones", subtitle: "Pólizas próximas a vencer o sin seguimiento", href: "/renewals", meta: "seguimiento" },
        { title: "Riesgos", subtitle: "Hallazgos críticos y advertencias", href: "/risks", meta: "auditoría" },
        { title: "Calidad de datos", subtitle: "Resumen de completitud y hallazgos", href: "/data-quality", meta: "control" },
      ],
    ),
    makeSection(
      "Sugerencias rápidas",
      `Usa estos accesos como punto de arranque en la ${accessLabel.toLowerCase()}.`,
      [
        { title: "Buscar póliza", subtitle: "Abrir una póliza por número o cliente", href: "/policies", meta: "consulta" },
        { title: "Crear renovación", subtitle: "Ir al flujo de alta con vínculo", href: "/policies/new", meta: "alta" },
        { title: "Revisar pendientes", subtitle: "Ver pendientes y seguimientos abiertos", href: "/work-items", meta: "operación" },
      ],
    ),
  ];
}

async function buildTodayReply(): Promise<AssistantReply> {
  const todayData = await getTodayData();
  const dueTodayCount = todayData.paymentsDueToday.length;
  const overdueCount = todayData.overduePayments.length;
  const due7Count = todayData.paymentsDue7.length;
  const renewalsCount = todayData.urgentRenewals.length;
  const overdueWorkItemsCount = todayData.overdueWorkItems.length;
  const commissionsCount = todayData.commissionsToReview.length;
  const cashFlowItems = [
    ...buildTodaySectionItems(todayData.overduePayments, (receipt) => ({
      title: `${receipt.client.fullName} · ${receipt.policy.policyNumber}`,
      subtitle: `${receipt.receiptNumber} · ${receipt.insurer.name}`,
      href: `/receipts/${receipt.id}`,
      meta: "vencido",
    })),
    ...buildTodaySectionItems(todayData.paymentsDueToday, (receipt) => ({
      title: `${receipt.client.fullName} · ${receipt.policy.policyNumber}`,
      subtitle: `${receipt.receiptNumber} · ${receipt.insurer.name}`,
      href: `/receipts/${receipt.id}`,
      meta: "hoy",
    })),
  ];
  const pendingItems = [
    ...buildTodaySectionItems(todayData.overdueWorkItems, (workItem) => ({
      title: workItem.title,
      subtitle: `${workItem.folio ?? workItem.id} · ${workItem.policy?.policyNumber ?? "Sin póliza"}`,
      href: `/tasks/${workItem.id}`,
      meta: "atrasado",
    })),
    ...buildTodaySectionItems(todayData.commissionsToReview, (commission) => ({
      title: commission.client.fullName,
      subtitle: `${commission.policy?.policyNumber ?? "Sin póliza"} · ${commission.insurer.name}`,
      href: "/commissions",
      meta: "comisión",
    })),
  ];

  const reply =
    `Hoy tienes ${overdueCount} recibo${overdueCount === 1 ? "" : "s"} vencido${overdueCount === 1 ? "" : "s"}, ` +
    `${dueTodayCount} que vencen hoy, ${due7Count} en los próximos 7 días, ` +
    `${renewalsCount} renovación${renewalsCount === 1 ? "" : "es"} en 30 días, ` +
    `${overdueWorkItemsCount} pendiente${overdueWorkItemsCount === 1 ? "" : "s"} atrasado${overdueWorkItemsCount === 1 ? "" : "s"} y ` +
    `${commissionsCount} comisión${commissionsCount === 1 ? "" : "es"} por revisar.`;

  return {
    reply,
    sections: [
      makeSection("Cobros de hoy", "Recibos vencidos, los de hoy y los próximos siete días.", cashFlowItems.length > 0 ? cashFlowItems : [
        { title: "Sin cobros urgentes", subtitle: "No hay recibos vencidos ni de hoy.", href: "/today", meta: "ok" },
      ]),
      makeSection(
        "Renovaciones",
        "Pólizas que vencen pronto.",
        todayData.urgentRenewals.length > 0
          ? buildTodaySectionItems(todayData.urgentRenewals, (policy) => ({
              title: policy.policyNumber,
              subtitle: `${policy.client.fullName} · Renovación ${policy.endDate.toISOString().slice(0, 10)}`,
              href: `/policies/${policy.id}`,
              meta: "30 días",
            }))
          : [{ title: "Sin renovaciones urgentes", subtitle: "No hay pólizas en el periodo de 30 días.", href: "/today", meta: "ok" }],
      ),
      makeSection("Pendientes", "Tareas atrasadas y comisiones próximas.", pendingItems.length > 0 ? pendingItems : [
        { title: "Sin pendientes urgentes", subtitle: "No hay tareas atrasadas ni comisiones inmediatas.", href: "/today", meta: "ok" },
      ]),
    ],
    quickPrompts: buildQuickPrompts(),
  };
}

function buildSearchTerms(message: string) {
  const terms = new Set<string>();
  for (const match of message.matchAll(/[A-Z0-9][A-Z0-9/-]{3,}/gi)) {
    terms.add(match[0]);
  }

  for (const match of message.matchAll(/(?:cliente|p[oó]liza|recibo|siniestro)\s+([^,.;?]+)/gi)) {
    const candidate = match[1]?.replace(/\b(?:es|la|el|de|del|una?|renovaci[oó]n)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (candidate && candidate.length >= 3) terms.add(candidate);
  }

  if (terms.size === 0) {
    const fallback = message
      .replace(/\b(?:busca|buscar|encuentra|encontrar|mu[eé]strame|cliente|p[oó]liza|recibo|por|favor)\b/gi, " ")
      .replace(/[^\p{L}\p{N}'/-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (fallback.length >= 3) terms.add(fallback);
  }

  return [...terms].slice(0, 3);
}

function toSearchItem(result: GlobalSearchResult) {
  return {
    title: result.title,
    subtitle: [result.subtitle, result.parentLabel, result.match ? `Coincide en ${result.match.fieldLabel}` : null]
      .filter(Boolean)
      .join(" · "),
    href: result.href,
    meta: result.type,
  };
}

export async function searchUserPortfolio(user: AssistantUser, message: string) {
  const terms = buildSearchTerms(message);
  const resultGroups = await Promise.all(terms.map((term) => globalSearch(term, user.role === "ADMIN" ? undefined : user.id)));
  const unique = new Map<string, GlobalSearchResult>();
  for (const result of resultGroups.flat()) unique.set(`${result.type}:${result.id}`, result);
  return [...unique.values()].slice(0, 8);
}

async function buildPromptReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);
  const renewalWindowDays = extractRenewalWindowDays(normalized);

  if (
    normalized.includes("hoy") ||
    normalized.includes("today") ||
    normalized.includes("diario") ||
    normalized.includes("agenda") ||
    (normalized.includes("resumen") && normalized.includes("dia"))
  ) {
    return buildTodayReply();
  }

  if (normalized.includes("renov")) {
    if (renewalWindowDays) {
      return buildRenewalsReply(renewalWindowDays);
    }

    return {
      reply: "Puedo ayudarte a revisar renovaciones próximas, vencidas o sin seguimiento. Si quieres, abre Renovaciones para ver los casos más urgentes o crea una póliza nueva vinculándola a la póliza anterior.",
      sections: [
        makeSection("Renovaciones", "Accesos directos para continuar el seguimiento.", [
          { title: "Ver renovaciones", subtitle: "Polizas próximas y vencidas", href: "/renewals", meta: "seguimiento" },
          { title: "Polizas sin seguimiento", subtitle: "Hallazgos que requieren vinculación", href: "/data-quality", meta: "hallazgos" },
        ]),
      ],
      quickPrompts: buildQuickPrompts(),
    };
  }

  if (
    normalized.includes("poliz") &&
    (normalized.includes("cambi") || normalized.includes("modific") || normalized.includes("editar") || normalized.includes("vencim") || normalized.includes("vigencia"))
  ) {
    return buildPolicyChangeReply(user, message);
  }

  if (normalized.includes("riesg")) {
    return {
      reply: "Si estás revisando riesgos, te conviene abrir el tablero de Riesgos y también Calidad de datos para ver hallazgos relacionados con renovación, recibos y completitud.",
      sections: [
        makeSection("Riesgos", "Hallazgos de mayor prioridad para revisar primero.", [
          { title: "Ver riesgos", subtitle: "Alertas activas y críticas", href: "/risks", meta: "prioridad" },
          { title: "Calidad de datos", subtitle: "Problemas de seguimiento y consistencia", href: "/data-quality", meta: "señales" },
        ]),
      ],
      quickPrompts: buildQuickPrompts(),
    };
  }

  if (normalized.includes("buscar") || normalized.includes("cliente") || normalized.includes("poliza") || normalized.includes("póliza")) {
    const results = await searchUserPortfolio(user, message);
    return {
      reply: results.length > 0
        ? `Encontré ${results.length} resultado${results.length === 1 ? "" : "s"} dentro de tu cartera.`
        : "No encontré coincidencias dentro de tu cartera. Prueba con el número de póliza, nombre completo, RFC, teléfono, serie o número de recibo.",
      sections: [
        makeSection(
          "Resultados",
          results.length > 0 ? "Coincidencias accesibles para tu usuario." : "No se muestran datos de otras carteras.",
          results.length > 0
            ? results.map(toSearchItem)
            : [{ title: "Abrir búsqueda", subtitle: "Buscar con más campos en PolicyDesk", href: "/policies", meta: "buscador" }],
        ),
      ],
      quickPrompts: buildQuickPrompts(),
    };
  }

  return {
    reply: "Te puedo ayudar a revisar renovaciones, riesgos, calidad de datos o a encontrar una póliza para continuar el flujo correcto. Si me dices qué estás buscando, te llevo a la sección más útil.",
    sections: [
      makeSection("Atajos", "Opciones comunes para arrancar rápido.", [
        { title: "Renovaciones", subtitle: "Casos próximos o vencidos", href: "/renewals", meta: "seguimiento" },
        { title: "Riesgos", subtitle: "Hallazgos críticos", href: "/risks", meta: "alertas" },
        { title: "Calidad de datos", subtitle: "Pendientes y consistencia", href: "/data-quality", meta: "control" },
      ]),
    ],
    quickPrompts: buildQuickPrompts(),
  };
}

export async function getAssistantHomeSnapshot(user: AssistantUser): Promise<AssistantSnapshot> {
  return {
    scopeLabel: user.role === "ADMIN" ? "Administración" : "Operación",
    welcome:
      user.role === "ADMIN"
        ? "Revisa renovaciones, riesgos y calidad de datos con vista administrativa."
        : "Consulta renovaciones, riesgos y calidad de datos desde una vista operativa.",
    ai: getAssistantAiConnectionStatus(),
    summaryCards: [
      { label: "Renovaciones", value: "Abrir", description: "Ver próximos vencimientos y seguimientos.", href: "/renewals" },
      { label: "Riesgos", value: "Abrir", description: "Revisar alertas y hallazgos críticos.", href: "/risks" },
      { label: "Calidad", value: "Abrir", description: "Inspeccionar datos y vínculos faltantes.", href: "/data-quality" },
    ],
    sections: buildHomeSections(user),
    quickPrompts: buildQuickPrompts(),
  };
}

export async function buildAssistantReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  return buildPromptReply(user, message);
}
