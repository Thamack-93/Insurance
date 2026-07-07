import "server-only";

import { buildAssistantReply as buildLocalAssistantReply, getAssistantHomeSnapshot as getLocalAssistantHomeSnapshot } from "@/lib/assistant-local";
import { buildAssistantAiReply, classifyAssistantReportSignalWithAi, getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { buildAssistantActionProposalFromPlan } from "@/lib/assistant-actions";
import { createAssistantThemeKey, listAssistantReports, recordAssistantReportSignal } from "@/lib/assistant-reports";
import { buildAssistantBlockedReply, evaluateAssistantInput } from "@/lib/assistant-guardrails";
import type {
  AssistantActionProposal,
  AssistantConversationResponse,
  AssistantReportKind,
  AssistantReportSeverity,
  AssistantReply,
  AssistantResponseSource,
  AssistantSnapshot,
  AssistantUser,
} from "@/lib/assistant-types";

type AssistantReportTheme = {
  kind: AssistantReportKind;
  themeKey: string;
  themeLabel: string;
  title: string;
  summary: string;
  recommendation: string;
  plan: string;
  severity: AssistantReportSeverity;
};

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

function shouldUseAssistantAi(normalized: string) {
  return (
    hasMutationIntent(normalized) ||
    normalized.includes("revisa") ||
    normalized.includes("valida") ||
    normalized.includes("verifica") ||
    normalized.includes("confirma") ||
    normalized.includes("duplica") ||
    normalized.includes("coincid") ||
    normalized.includes("simil") ||
    normalized.includes("endoso") ||
    normalized.includes("renovacion") ||
    normalized.includes("pdf") ||
    normalized.includes("caratula") ||
    normalized.includes("detalle") ||
    normalized.includes("falta") ||
    normalized.includes("corrige")
  );
}

function hasMutationIntent(normalized: string) {
  return (
    normalized.includes("actualiz") ||
    normalized.includes("cambi") ||
    normalized.includes("modific") ||
    normalized.includes("edita") ||
    normalized.includes("corrig") ||
    normalized.includes("crea") ||
    normalized.includes("agrega") ||
    normalized.includes("anad") ||
    normalized.includes("anade") ||
    normalized.includes("registra pago") ||
    normalized.includes("registrar pago") ||
    normalized.includes("aplica pago") ||
    normalized.includes("nuevo cliente") ||
    normalized.includes("nueva poliza") ||
    normalized.includes("nuevo recibo") ||
    normalized.includes("nueva tarea")
  );
}

function detectTheme(normalized: string): AssistantReportTheme | null {
  const hasFailure = normalized.includes("error") || normalized.includes("falla") || normalized.includes("no funciona") || normalized.includes("rompe");
  const hasProductNeed = hasFailure || normalized.includes("necesito") || normalized.includes("falta") || normalized.includes("deberia") || normalized.includes("mejora") || normalized.includes("sugerencia") || normalized.includes("no encuentro");

  if (hasFailure) {
    return {
      kind: "INCIDENT" as const,
      themeKey: createAssistantThemeKey([normalized.includes("pdf") ? "pdf" : null, normalized.includes("telegram") ? "telegram" : null, "error", "sistema"]),
      themeLabel: normalized.includes("pdf") ? "Error en captura de pólizas por PDF" : "Error de producto",
      title: normalized.includes("pdf") ? "Fallo reportado en captura por PDF" : "Fallo reportado en PolicyDesk",
      summary: "El usuario reportó un flujo que no funciona como se esperaba.",
      recommendation: "Reproducir el caso, identificar la capa afectada y corregir la causa raíz.",
      plan: "Conservar evidencia, reproducir el error, añadir una prueba de regresión y validar el flujo completo.",
      severity: "HIGH" as const,
    };
  }

  if (hasProductNeed && (normalized.includes("pdf") || normalized.includes("caratula") || normalized.includes("documento"))) {
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

  if (hasProductNeed && normalized.includes("telegram")) {
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

  if (normalized.includes("reporte") || normalized.includes("export") || normalized.includes("descarg")) {
    const isDailySummary = normalized.includes("hoy") || normalized.includes("diario") || normalized.includes("resumen");
    const isReceiptReport = normalized.includes("recibo") || normalized.includes("cobro") || normalized.includes("pago");
    const isRenewalReport = normalized.includes("renov");
    const themeParts = [
      "reportes",
      isDailySummary ? "diario" : null,
      isReceiptReport ? "cobros" : null,
      isRenewalReport ? "renovaciones" : null,
    ];
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey(themeParts),
      themeLabel: isDailySummary
        ? "Reportes diarios"
        : isReceiptReport
          ? "Reportes de cobros"
          : isRenewalReport
            ? "Reportes de renovaciones"
            : "Reportes globales",
      title: isDailySummary
        ? "Mejoras en resumen diario"
        : isReceiptReport
          ? "Mejoras en reportes de cobros"
          : isRenewalReport
            ? "Mejoras en reportes de renovaciones"
            : "Mejoras en generación de reportes",
      summary: "Se pidió un reporte o exportación con contexto recurrente.",
      recommendation: "Revisar si falta una vista, filtro o exportación reutilizable.",
      plan: "Contar repeticiones, normalizar el tema y abrir una sola sugerencia consolidada.",
      severity: "MEDIUM" as const,
    };
  }

  if (hasProductNeed && (normalized.includes("buscar") || normalized.includes("vincular") || normalized.includes("consolidar") || normalized.includes("renovacion"))) {
    const isConsolidation = normalized.includes("consolid");
    const isRenewal = normalized.includes("renov");
    const isSearch = normalized.includes("buscar") || normalized.includes("encuent");
    return {
      kind: "SUGGESTION" as const,
      themeKey: createAssistantThemeKey([
        isConsolidation ? "consolidacion" : isSearch ? "busqueda" : "vinculacion",
        isRenewal ? "renovacion" : null,
        normalized.includes("cliente") ? "cliente" : null,
        normalized.includes("poliza") ? "poliza" : null,
      ]),
      themeLabel: isConsolidation
        ? "Consolidación de clientes"
        : isRenewal
          ? "Renovaciones con contexto"
          : "Búsqueda y vínculos",
      title: isConsolidation
        ? "Mejoras en consolidación de clientes"
        : isRenewal
          ? "Mejoras en búsquedas de renovación"
          : "Mejoras en búsqueda y vinculación",
      summary: isConsolidation
        ? "Se detectó una necesidad repetida de consolidar clientes o evitar duplicados."
        : "Se detectó una necesidad de búsqueda o de vincular entidades relacionadas.",
      recommendation: isConsolidation
        ? "Revisar resultados, similitud y datos visibles para consolidar con menos fricción."
        : "Revisar resultados, contexto mostrado y acciones disponibles.",
      plan: isConsolidation
        ? "Agrupar repeticiones por tema, mostrar más contexto y proponer un destino canónico."
        : "Agrupar repeticiones por tema y proponer mejoras de contexto o accesos directos.",
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
  const snapshot = await getLocalAssistantHomeSnapshot(user);
  return {
    ...snapshot,
    ai: getAssistantAiConnectionStatus(),
  };
}

export async function buildAssistantReply(user: AssistantUser, message: string): Promise<AssistantConversationResponse> {
  const guardrail = evaluateAssistantInput(message);
  const normalized = normalizeMessage(message);
  if (!guardrail.allowed) {
    return {
      reply: buildAssistantBlockedReply(),
      sections: [],
      quickPrompts: [
        { label: "Buscar una póliza", prompt: "Buscar póliza" },
        { label: "Ver renovaciones", prompt: "Renovaciones próximas" },
        { label: "Recibos vencidos", prompt: "Recibos vencidos" },
      ],
      source: "local",
      reportId: null,
      reportThemeKey: null,
      reportThemeLabel: null,
    };
  }

  const localReply = await buildLocalAssistantReply(user, message);
  const theme = detectTheme(normalized);
  const shouldTryAi =
    !theme &&
    (shouldUseAssistantAi(normalized) || !isDeterministicQuery(normalized) || message.includes("?") || message.length > 160);

  let finalReply: AssistantReply = localReply;
  let source: AssistantResponseSource = "local";
  let actionProposal: AssistantActionProposal | null = null;

  if (shouldTryAi) {
    const aiReply = await buildAssistantAiReply({
      user,
      message,
      localReply,
      themeHint: null,
    });
    if (aiReply) {
      finalReply = {
        reply: aiReply.reply,
        sections: aiReply.sections,
        quickPrompts: aiReply.quickPrompts,
      };
      source = "ai";
      if (aiReply.mutation) {
        actionProposal = await buildAssistantActionProposalFromPlan(aiReply.mutation, user);
      }
    }
  }

  let reportTheme: AssistantReportTheme | null = theme;
  if (shouldTryAi || theme) {
    const activeReports = (await listAssistantReports({ limit: 100 }).catch(() => []))
      .filter((report) => report.status === "OPEN" || report.status === "COLLECTING")
      .map((report) => ({ themeKey: report.themeKey, themeLabel: report.themeLabel, kind: report.kind }));
    const aiReport = await classifyAssistantReportSignalWithAi({
      user,
      message,
      localReplyText: `${localReply.reply}\n\n${localReply.sections
        .map((section) => `${section.title}\n${section.summary}\n${section.items.map((item) => `${item.title} · ${item.subtitle ?? ""} · ${item.meta ?? ""}`).join("\n")}`)
        .join("\n\n")}`,
      existingThemes: activeReports,
      fallback: theme ?? null,
    });
    if (aiReport) {
      reportTheme = aiReport.shouldReport
        ? {
            kind: aiReport.kind,
            themeKey: aiReport.themeKey,
            themeLabel: aiReport.themeLabel,
            title: aiReport.title,
            summary: aiReport.summary,
            recommendation: aiReport.recommendation,
            plan: aiReport.plan,
            severity: aiReport.severity,
          }
        : theme?.kind === "INCIDENT" ? theme : null;
    }
  }

  let reportId: string | null = null;
  if (reportTheme) {
    try {
      const aiStatus = getAssistantAiConnectionStatus();
      const report = await recordAssistantReportSignal({
        kind: reportTheme.kind,
        themeKey: reportTheme.themeKey,
        themeLabel: reportTheme.themeLabel,
        signalKind: source === "ai" ? "AI_RESPONSE" : "USER_MESSAGE",
        source: "assistant",
        title: reportTheme.title,
        summary: reportTheme.summary,
        recommendation: reportTheme.recommendation,
        plan: reportTheme.plan,
        severity: reportTheme.severity,
        evidence: {
          source,
          aiAvailable: aiStatus.available,
          aiMode: aiStatus.authMode,
          messageLength: message.length,
          normalizedLength: normalized.length,
          reportTheme: reportTheme.themeLabel,
        },
        input: { redacted: true },
        output: { redacted: true },
        actorId: user.id,
        forceOpen: reportTheme.kind === "INCIDENT",
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
    reportThemeKey: reportTheme?.themeKey ?? null,
    reportThemeLabel: reportTheme?.themeLabel ?? null,
    actionProposal,
  };
}
