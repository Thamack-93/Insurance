import "server-only";

import type { AssistantPrompt, AssistantReply, AssistantSection, AssistantSnapshot, AssistantUser } from "@/lib/assistant-types";

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

function buildPromptReply(message: string): AssistantReply {
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
    return {
      reply: "Puedo ayudarte a ubicar una póliza o cliente y luego saltar al flujo correcto. Si la póliza ya se renovó, la ruta más útil suele ser la póliza nueva o el apartado de renovaciones para dejar el vínculo bien cerrado.",
      sections: [
        makeSection("Búsqueda", "Rutas útiles para localizar y continuar.", [
          { title: "Ir a pólizas", subtitle: "Buscar por número, cliente o aseguradora", href: "/policies", meta: "buscador" },
          { title: "Crear póliza", subtitle: "Iniciar una nueva póliza", href: "/policies/new", meta: "captura" },
        ]),
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
  void user;
  return buildPromptReply(message);
}
