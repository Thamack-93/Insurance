import "server-only";

import { buildAssistantReply as buildLocalAssistantReply, getAssistantHomeSnapshot as getLocalAssistantHomeSnapshot } from "@/lib/assistant-local";
import { buildAssistantAiReply } from "@/lib/assistant-ai";
import { createAssistantThemeKey, recordAssistantReportSignal } from "@/lib/assistant-reports";
import type {
  AssistantConversationResponse,
  AssistantReply,
  AssistantResponseSource,
  AssistantSnapshot,
  AssistantUser,
} from "@/lib/assistant-types";

function normalizeMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function isDeterministicQuery(normalized: string) {
  return (
    !normalized ||
    normalized === "hola" ||
    normalized === "buenos dias" ||
    normalized === "buenas" ||
    normalized === "help" ||
    normalized === "ayuda" ||
    normalized === "menu" ||
    normalized.includes("hoy") ||
    normalized.includes("today") ||
    normalized.includes("renov") ||
    normalized.includes("riesg") ||
    normalized.includes("pendient") ||
    normalized.includes("tarea") ||
    normalized.includes("task") ||
    normalized.includes("recibo") ||
    normalized.includes("cobro") ||
    normalized.includes("pago") ||
    normalized.includes("cliente") ||
    normalized.includes("poliza")
  );
}

function detectTheme(normalized: string) {
  if (normalized.includes("pdf") || normalized.includes("caratula") || normalized.includes("carátula") || normalized.includes("documento")) {
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(["pdf", "captura", "pólizas"]),
      themeLabel: "Captura de pólizas por PDF",
      title: "Mejoras en captura de pólizas por PDF",
      summary: "Se mencionó captura o revisión de PDFs de póliza con posible fricción o duda.",
      recommendation: "Revisar el parser, la revisión IA y el preview antes de guardar.",
      plan: "Acumular señales repetidas, comparar patrones de extracción y mejorar la revisión asistida.",
      severity: "HIGH" as const,
    };
  }

  if (normalized.includes("telegram")) {
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(["telegram", "captura", "pólizas"]),
      themeLabel: "Captura por Telegram",
      title: "Mejoras en captura por Telegram",
      summary: "Se habló de flujo de Telegram para PDFs o captura asistida.",
      recommendation: "Revisar recepción de documentos, resumen inline y enlace a revisión web.",
      plan: "Acumular señales del canal Telegram y centralizar los casos dudosos en revisión web.",
      severity: "MEDIUM" as const,
    };
  }

  if (normalized.includes("error") || normalized.includes("falla") || normalized.includes("no funciona") || normalized.includes("rompe")) {
    return {
      kind: "INCIDENT" as const,
      themeKey: createAssistantThemeKey(["error", "asistente"]),
      themeLabel: "Error del asistente",
      title: "Error reportado por el asistente",
      summary: "Se reportó un error o un flujo que no funciona como se esperaba.",
      recommendation: "Revisar el flujo asociado y corregir la causa raíz.",
      plan: "Registrar el incidente, agrupar señales similares y cerrar cuando quede resuelto.",
      severity: "CRITICAL" as const,
    };
  }

  if (normalized.includes("reporte") || normalized.includes("export") || normalized.includes("descarg")) {
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(["reportes", "globales"]),
      themeLabel: "Reportes globales",
      title: "Mejoras en generación de reportes",
      summary: "Se pidió un reporte o exportación con contexto recurrente.",
      recommendation: "Revisar si falta una vista, filtro o exportación reutilizable.",
      plan: "Contar repeticiones, normalizar el tema y abrir una sola sugerencia consolidada.",
      severity: "MEDIUM" as const,
    };
  }

  if (
    normalized.includes("no encuentro") ||
    normalized.includes("buscar") ||
    normalized.includes("vincular") ||
    normalized.includes("consolidar") ||
    normalized.includes("renovacion") ||
    normalized.includes("renovación")
  ) {
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(["busqueda", "vinculos"]),
      themeLabel: "Búsqueda y vínculos",
      title: "Mejoras en búsqueda y vinculación",
      summary: "Se detectó una necesidad de búsqueda o de vincular entidades relacionadas.",
      recommendation: "Revisar resultados, contexto mostrado y acciones disponibles.",
      plan: "Agrupar repeticiones por tema y proponer mejoras de contexto o accesos directos.",
      severity: "MEDIUM" as const,
    };
  }

  if (normalized.includes("mejora") || normalized.includes("sugerencia")) {
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(["mejoras", "producto"]),
      themeLabel: "Sugerencias de producto",
      title: "Sugerencias de mejora de producto",
      summary: "El usuario pidió mejoras o reportó una sugerencia acumulable.",
      recommendation: "Consolidar señales similares para no abrir duplicados.",
      plan: "Agrupar evidencia por tema normalizado y evolucionar una sola sugerencia.",
      severity: "LOW" as const,
    };
  }

  return null;
}

export async function getAssistantHomeSnapshot(user: AssistantUser): Promise<AssistantSnapshot> {
  return getLocalAssistantHomeSnapshot(user);
}

export async function buildAssistantReply(user: AssistantUser, message: string): Promise<AssistantConversationResponse> {
  const normalized = normalizeMessage(message);
  const localReply = await buildLocalAssistantReply(user, message);
  const theme = detectTheme(normalized);
  const shouldTryAi = !isDeterministicQuery(normalized) || Boolean(theme) || message.includes("?") || message.length > 160;

  let finalReply: AssistantReply = localReply;
  let source: AssistantResponseSource = "local";

  if (shouldTryAi) {
    const aiReply = await buildAssistantAiReply({
      user,
      message,
      localReply,
      themeHint: theme?.themeLabel ?? null,
    });
    if (aiReply) {
      finalReply = aiReply;
      source = "ai";
    }
  }

  let reportId: string | null = null;
  if (theme) {
    try {
      const report = await recordAssistantReportSignal({
        kind: theme.kind,
        themeKey: theme.themeKey,
        themeLabel: theme.themeLabel,
        signalKind: source === "ai" ? "AI_RESPONSE" : "USER_MESSAGE",
        source: "assistant",
        title: theme.title,
        summary: theme.summary,
        recommendation: theme.recommendation,
        plan: theme.plan,
        severity: theme.severity,
        evidence: {
          message,
          normalized,
          source,
        },
        input: { message },
        output: { reply: finalReply.reply },
        actorId: user.id,
        forceOpen: theme.kind === "INCIDENT",
      });
      reportId = report.id;
    } catch {
      reportId = null;
    }
  }

  return {
    ...finalReply,
    source,
    reportId,
    reportThemeKey: theme?.themeKey ?? null,
    reportThemeLabel: theme?.themeLabel ?? null,
  };
}
