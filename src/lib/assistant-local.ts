import "server-only";

import type { AssistantPrompt, AssistantReply, AssistantSection, AssistantSnapshot, AssistantUser } from "@/lib/assistant-types";
import { globalSearch, type GlobalSearchResult } from "@/lib/search";

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

async function searchUserPortfolio(user: AssistantUser, message: string) {
  const terms = buildSearchTerms(message);
  const resultGroups = await Promise.all(terms.map((term) => globalSearch(term, user.role === "ADMIN" ? undefined : user.id)));
  const unique = new Map<string, GlobalSearchResult>();
  for (const result of resultGroups.flat()) unique.set(`${result.type}:${result.id}`, result);
  return [...unique.values()].slice(0, 8);
}

async function buildPromptReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);

  if (normalized.includes("renov")) {
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
