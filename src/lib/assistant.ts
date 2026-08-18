import "server-only";

import {
  buildAssistantReply as buildLocalAssistantReply,
  getAssistantHomeSnapshot as getLocalAssistantHomeSnapshot,
  searchUserPortfolio,
} from "@/lib/assistant-local";
import {
  buildAssistantAiReply,
  getAssistantAiConnectionStatus,
  getAssistantAiModelLabel,
  getAssistantAiOperationLabel,
} from "@/lib/assistant-ai";
import { buildAssistantActionProposalFromPlan } from "@/lib/assistant-actions";
import { createAssistantThemeKey, recordAssistantReportSignal } from "@/lib/assistant-reports";
import { buildAssistantBlockedReply, buildGmmPrivacyReply, evaluateAssistantInput, evaluateGmmPrivacy } from "@/lib/assistant-guardrails";
import { getNoraAiBudgetStatus, isNoraAgentEnabledForUser } from "@/lib/assistant-agent-config";
import type {
  AssistantAiDiagnostic,
  AssistantAiExecutionProfile,
  AssistantActionProposal,
  AssistantConversationResponse,
  AssistantReportKind,
  AssistantReportSeverity,
  AssistantReply,
  AssistantAiTier,
  AssistantAiTerminationReason,
  AssistantAiTraceEntry,
  AssistantAiUsageSnapshot,
  AssistantAiToolTraceEntry,
  AssistantHistoryMessage,
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

function buildAssistantAiFallbackNotice(diagnostic: AssistantAiDiagnostic) {
  const parts = [
    `${getAssistantAiModelLabel(diagnostic.model)} no completó ${getAssistantAiOperationLabel(diagnostic.operation)}: ${diagnostic.code}`,
  ];
  if (diagnostic.statusCode) {
    parts.push(`HTTP ${diagnostic.statusCode}`);
  }
  parts.push(`diagnóstico ${diagnostic.diagnosticId}`);
  return parts.join(" · ");
}

function buildAssistantAiFailureTheme(diagnostic: AssistantAiDiagnostic): AssistantReportTheme {
  return {
    kind: "INCIDENT",
    themeKey: createAssistantThemeKey(["assistant-ai", diagnostic.operation, diagnostic.code, diagnostic.model]),
    themeLabel: `IA · ${getAssistantAiOperationLabel(diagnostic.operation)}`,
    title: `Nora no completó ${getAssistantAiOperationLabel(diagnostic.operation)}`,
    summary: diagnostic.summary,
    recommendation: "Revisar el folio del diagnóstico, la latencia y el estado del gateway antes de volver a intentar.",
    plan: `${diagnostic.details}${diagnostic.responsePreview ? `\n\nRespuesta parcial:\n${diagnostic.responsePreview}` : ""}`,
    severity: diagnostic.code === "timeout" ? "HIGH" : "MEDIUM",
  };
}

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

function isLocalOnlyQuery(normalized: string) {
  return ["", "hola", "buenos dias", "buenas", "help", "ayuda", "menu", "que puedes hacer"].includes(normalized);
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
    normalized.includes("inconsist") ||
    normalized.includes("descuadr") ||
    normalized.includes("solap") ||
    normalized.includes("concil") ||
    normalized.includes("simil") ||
    normalized.includes("endoso") ||
    normalized.includes("pdf") ||
    normalized.includes("caratula") ||
    normalized.includes("detalle") ||
    normalized.includes("corrige")
  );
}

function hasMutationIntent(normalized: string) {
  const asksForDraft = ["borrador", "prepara", "propuesta"].some((phrase) => normalized.includes(phrase));
  const explicitReadOnly = [
    "no modifi",
    "sin modifi",
    "no cambies",
    "sin cambiar",
    "consulta informativa",
    "solo analiza",
    "solo revisa",
  ].some((phrase) => normalized.includes(phrase));
  if (explicitReadOnly && !asksForDraft) return false;

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

function resolveAgentExecutionPlan(normalized: string): {
  profile: AssistantAiExecutionProfile;
  activeTools?: string[];
  requiredTool?: string | null;
} {
  if (["cobertura", "condiciones", "exclusion", "exclusión", "deducible", "ampara", "poliza", "póliza", "aseguradora", "seguro", "significa"].some((term) => normalized.includes(term)) && !hasMutationIntent(normalized)) {
    return { profile: "simple-read", activeTools: ["searchKnowledgeBase"], requiredTool: "searchKnowledgeBase" };
  }
  if (
    normalized.includes("hoy") ||
    normalized.includes("today") ||
    normalized.includes("agenda") ||
    normalized.includes("resumen") ||
    normalized.includes("brief") ||
    normalized.includes("dia")
  ) {
    return { profile: "simple-read", activeTools: ["getTodayBrief"], requiredTool: "getTodayBrief" };
  }
  if (normalized.includes("renov")) {
    return { profile: "simple-read", activeTools: ["listRenewals"], requiredTool: "listRenewals" };
  }
  if (normalized.includes("recibo") || normalized.includes("cobro")) {
    return { profile: "simple-read", activeTools: ["listReceipts"], requiredTool: "listReceipts" };
  }
  if (normalized.includes("buscar") || normalized.includes("cliente") || normalized.includes("poliza")) {
    return { profile: "simple-read", activeTools: ["searchPortfolio", "getEntitySummary"], requiredTool: "searchPortfolio" };
  }
  if (normalized.includes("pendient") || normalized.includes("tarea") || normalized.includes("task")) {
    return { profile: "simple-read", activeTools: ["listOpenWorkItems"], requiredTool: "listOpenWorkItems" };
  }
  if (normalized.includes("siniestro") || normalized.includes("claim") || normalized.includes("checklist")) {
    return { profile: "simple-read", activeTools: ["listClaims", "getClaimChecklist"], requiredTool: "listClaims" };
  }
  return { profile: "complex-read" };
}

function detectTheme(normalized: string): AssistantReportTheme | null {
  if (hasMutationIntent(normalized)) {
    return null;
  }

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

function extractPolicyFocus(message: string, localReply: AssistantReply) {
  const explicitPolicyNumber = message.match(/\b\d{5,}\b/)?.[0] ?? null;

  if (explicitPolicyNumber) {
    for (const section of localReply.sections) {
      for (const item of section.items) {
        if (item.title === explicitPolicyNumber) {
          const [clientName, insurerName, policyType, status] = (item.subtitle ?? "").split(" · ").map((value) => value.trim());
          return {
            policyNumber: item.title,
            clientName: clientName ?? null,
            insurerName: insurerName ?? null,
            policyType: policyType ?? null,
            status: status ?? null,
            href: item.href,
          };
        }
      }
    }
  }

  for (const section of localReply.sections) {
    for (const item of section.items) {
      if (!item.href.startsWith("/policies/")) continue;
      const [clientName, insurerName, policyType, status] = (item.subtitle ?? "").split(" · ").map((value) => value.trim());
      return {
        policyNumber: item.title,
        clientName: clientName ?? null,
        insurerName: insurerName ?? null,
        policyType: policyType ?? null,
        status: status ?? null,
        href: item.href,
      };
    }
  }

  return null;
}

function formatContextResults(results: Awaited<ReturnType<typeof searchUserPortfolio>>) {
  return results
    .slice(0, 6)
    .map((result) => {
      const details = [result.subtitle, result.parentLabel, result.details?.slice(0, 2).join(" · "), result.match ? `Coincide en ${result.match.fieldLabel}` : null]
        .filter(Boolean)
        .join(" · ");
      return `- ${result.type}: ${result.title}${details ? ` · ${details}` : ""}${result.href ? ` · ${result.href}` : ""}`;
    })
    .join("\n");
}

async function buildAssistantAiContext(user: AssistantUser, message: string, localReply: AssistantReply) {
  const baseResults = await searchUserPortfolio(user, message).catch(() => []);
  const focus = extractPolicyFocus(message, localReply);
  const relatedResults = focus
    ? await searchUserPortfolio(
        user,
        [focus.policyNumber, focus.clientName, focus.insurerName, focus.policyType, focus.status]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join(" "),
      ).catch(() => [])
    : [];

  const deduped = new Map<string, (typeof baseResults)[number]>();
  for (const result of [...baseResults, ...relatedResults]) {
    deduped.set(`${result.type}:${result.id}`, result);
  }

  const combinedResults = [...deduped.values()];
  const localReplySections = localReply.sections.length
    ? localReply.sections
        .map((section) => {
          const items = section.items
            .slice(0, 4)
            .map((item) => `- ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}${item.meta ? ` · ${item.meta}` : ""}`)
            .join("\n");
          return `${section.title}\n${section.summary}\n${items}`.trim();
        })
        .join("\n\n")
    : "Sin secciones locales.";

  return [
    `Respuesta local:\n${localReply.reply}`,
    `Secciones locales:\n${localReplySections}`,
    combinedResults.length > 0 ? `Coincidencias accesibles:\n${formatContextResults(combinedResults)}` : "Coincidencias accesibles: ninguna.",
    focus
      ? `Póliza foco:
- póliza: ${focus.policyNumber}
- cliente: ${focus.clientName ?? "Sin dato"}
- aseguradora: ${focus.insurerName ?? "Sin dato"}
- tipo: ${focus.policyType ?? "Sin dato"}
- estado: ${focus.status ?? "Sin dato"}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function getAssistantHomeSnapshot(user: AssistantUser): Promise<AssistantSnapshot> {
  const snapshot = await getLocalAssistantHomeSnapshot(user);
  return {
    ...snapshot,
    ai: getAssistantAiConnectionStatus(),
  };
}

export async function buildAssistantReply(
  user: AssistantUser,
  message: string,
  options: { history?: AssistantHistoryMessage[]; contextText?: string | null; gmmMetadataOnly?: boolean; abortSignal?: AbortSignal } = {},
): Promise<AssistantConversationResponse> {
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

  const gmmMode = Boolean(options.gmmMetadataOnly || /\bgmm\b|gastos medicos|gastos médicos/i.test(message));
  if (gmmMode && !evaluateGmmPrivacy(message, Boolean(options.gmmMetadataOnly)).allowed) {
    return {
      reply: buildGmmPrivacyReply(),
      sections: [],
      quickPrompts: [
        { label: "Ver checklist", prompt: "Ver checklist de requisitos GMM" },
        { label: "Ver faltantes", prompt: "Mostrar requisitos faltantes de GMM" },
      ],
      source: "local",
      reportId: null,
      reportThemeKey: null,
      reportThemeLabel: null,
      aiPromptVersion: null,
      aiToolTrace: [],
    };
  }

  const localMessage = options.contextText ? `${message}\n\nContexto explícitamente aceptado: ${options.contextText}.` : message;
  let localReply: AssistantReply | null = null;
  async function getLocalReply() {
    if (!localReply) localReply = await buildLocalAssistantReply(user, localMessage);
    return localReply;
  }

  const theme = detectTheme(normalized);
  const agentEnabled = isNoraAgentEnabledForUser(user);
  const mutationIntent = hasMutationIntent(normalized);
  const agentExecutionPlan = agentEnabled && !mutationIntent ? resolveAgentExecutionPlan(normalized) : null;
  const isKnownAgentRead = agentExecutionPlan?.profile === "simple-read";
  let shouldTryAi = theme?.kind !== "INCIDENT" && (agentEnabled
    ? isKnownAgentRead || !isLocalOnlyQuery(normalized)
    : shouldUseAssistantAi(normalized) || (!isDeterministicQuery(normalized) && message.length > 40) || message.length > 220);
  const budget = agentEnabled && shouldTryAi
    ? await getNoraAiBudgetStatus(user.organizationId).catch(() => ({ allowed: true, warning: null, spentUsd: 0, limitUsd: 4 }))
    : { allowed: true, warning: null, spentUsd: 0, limitUsd: 4 };
  if (!budget.allowed) shouldTryAi = false;

  const aiContext = shouldTryAi
    ? agentEnabled
      ? options.contextText ?? null
      : await buildAssistantAiContext(user, message, await getLocalReply())
    : theme
      ? await buildAssistantAiContext(user, message, await getLocalReply())
      : null;

  let finalReply: AssistantReply = shouldTryAi ? { reply: "", sections: [], quickPrompts: [] } : await getLocalReply();
  let source: AssistantResponseSource = "local";
  let actionProposal: AssistantActionProposal | null = null;
  let aiFallbackNotice: string | null = null;
  let aiDiagnostic: AssistantAiDiagnostic | null = null;
  let aiRunId: string | null = null;
  let aiTrackingStatus: "recorded" | "unavailable" | undefined;
  let aiTier: AssistantAiTier | null = null;
  let aiModel: string | null = null;
  let aiAttempts = 0;
  let aiUsage: AssistantAiUsageSnapshot | null = null;
  let aiTrace: AssistantAiTraceEntry[] = [];
  let aiToolTrace: AssistantAiToolTraceEntry[] = [];
  let aiPromptVersion: string | null = null;
  let aiExecutionProfile: AssistantAiExecutionProfile | null = null;
  let aiStepCount: number | null = null;
  let aiTerminationReason: AssistantAiTerminationReason | null = null;
  const aiMode = mutationIntent
    ? "structured" as const
    : agentEnabled
      ? "agent" as const
      : "conversation" as const;

  if (shouldTryAi) {
    const safeHistory = (options.history ?? [])
      .filter((entry) => !gmmMode || evaluateGmmPrivacy(entry.content, false).allowed)
      .slice(-6);
    const aiReply = await buildAssistantAiReply({
      user,
      message,
      localReply: agentEnabled ? { reply: "", sections: [], quickPrompts: [] } : await getLocalReply(),
      contextText: aiContext,
      themeHint: null,
      mode: aiMode,
      history: safeHistory,
      gmmMetadataOnly: gmmMode,
      executionProfile: mutationIntent ? "draft" : agentExecutionPlan?.profile,
      activeTools: agentExecutionPlan?.activeTools,
      requiredTool: agentExecutionPlan?.requiredTool,
      abortSignal: options.abortSignal,
    });
    if (aiReply.ok) {
      finalReply = {
        reply: aiReply.value.reply,
        sections: [],
        quickPrompts: aiReply.value.quickPrompts,
        knowledgeCitations: aiReply.value.knowledgeCitations,
      };
      source = "ai";
      aiRunId = aiReply.value.runId ?? null;
      aiTrackingStatus = aiReply.value.trackingStatus;
      aiTier = aiReply.value.tier;
      aiModel = aiReply.value.resolvedModel;
      aiAttempts = aiReply.value.trace.length;
      aiUsage = aiReply.value.totalUsage
        ? {
            ...aiReply.value.totalUsage,
            estimatedCostUsd: aiReply.value.totalUsage.estimatedCostUsd ?? null,
          }
        : aiReply.value.usage
          ? { ...aiReply.value.usage, estimatedCostUsd: aiReply.value.usage.estimatedCostUsd ?? null }
          : null;
      aiTrace = aiReply.value.trace;
      aiToolTrace = aiReply.value.toolTrace;
      aiPromptVersion = aiReply.value.promptVersion;
      aiExecutionProfile = aiReply.value.executionProfile;
      aiStepCount = aiReply.value.stepCount;
      aiTerminationReason = aiReply.value.terminationReason;
      if (aiMode === "agent") {
        actionProposal = aiReply.value.actionProposal;
      } else if (aiMode === "structured" && aiReply.value.mutation) {
        actionProposal = await buildAssistantActionProposalFromPlan(aiReply.value.mutation, user);
      }
    } else {
      finalReply = await getLocalReply();
      aiDiagnostic = aiReply.diagnostic;
      aiFallbackNotice = buildAssistantAiFallbackNotice(aiReply.diagnostic);
      aiRunId = aiReply.diagnostic.runId ?? null;
      aiTier = aiReply.diagnostic.tier ?? null;
      aiModel = aiReply.diagnostic.resolvedModel ?? aiReply.diagnostic.model;
      aiAttempts = aiReply.diagnostic.trace?.length ?? 0;
      aiUsage = aiReply.diagnostic.usage ?? null;
      aiTrace = aiReply.diagnostic.trace ?? [];
      aiExecutionProfile = mutationIntent ? "draft" : agentExecutionPlan?.profile ?? null;
      aiTerminationReason = aiReply.diagnostic.code === "timeout" ? "timeout" : aiReply.diagnostic.code === "incomplete_output" ? "length" : "error";
    }
  }

  let reportTheme: AssistantReportTheme | null = theme;
  if (!reportTheme && aiDiagnostic && aiDiagnostic.code !== "unavailable") {
    reportTheme = buildAssistantAiFailureTheme(aiDiagnostic);
  }

  let reportId: string | null = null;
  if (reportTheme) {
    try {
      const aiStatus = getAssistantAiConnectionStatus();
      const signalKind = aiDiagnostic ? "AI_FAILURE" : source === "ai" ? "AI_RESPONSE" : "USER_MESSAGE";
      const report = await recordAssistantReportSignal({
        organizationId: user.organizationId!,
        kind: reportTheme.kind,
        themeKey: reportTheme.themeKey,
        themeLabel: reportTheme.themeLabel,
        signalKind,
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
          aiRunId,
          aiTier,
          aiModel,
          aiAttempts,
          aiTrace,
          aiUsage,
          aiDiagnostic,
        },
        input: { redacted: true },
        output: { redacted: true },
        diagnostic: aiDiagnostic,
        actorId: user.id,
        forceOpen: reportTheme.kind === "INCIDENT",
      });
      reportId = report.id;
      if (aiDiagnostic) {
        aiDiagnostic = {
          ...aiDiagnostic,
          reportId: report.id,
        };
      }
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
    aiRunId,
    aiTrackingStatus,
    aiTier,
    aiModel,
    aiAttempts,
    aiUsage,
    aiTrace,
    aiToolTrace,
    aiPromptVersion,
    aiExecutionProfile,
    aiStepCount,
    aiTerminationReason,
    aiBudgetWarning: budget.warning,
    aiFallbackNotice,
    aiDiagnostic,
    actionProposal,
  };
}
