import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  buildLocalAssistantReply: vi.fn(),
  getLocalAssistantHomeSnapshot: vi.fn(),
  searchUserPortfolio: vi.fn(),
  buildAssistantAiReply: vi.fn(),
  executeNoraSimpleRead: vi.fn(),
  classifyAssistantReportSignalWithAi: vi.fn(),
  getAssistantAiConnectionStatus: vi.fn(),
  getAssistantAiModelLabel: vi.fn(),
  getAssistantAiOperationLabel: vi.fn(),
  buildAssistantActionProposalFromPlan: vi.fn(),
  createAssistantThemeKey: vi.fn(),
  listAssistantReports: vi.fn(),
  recordAssistantReportSignal: vi.fn(),
  buildAssistantBlockedReply: vi.fn(),
  buildGmmPrivacyReply: vi.fn(),
  evaluateAssistantInput: vi.fn(),
  evaluateGmmPrivacy: vi.fn(),
}));

vi.mock("@/lib/assistant-local", () => ({
  buildAssistantReply: mocks.buildLocalAssistantReply,
  getAssistantHomeSnapshot: mocks.getLocalAssistantHomeSnapshot,
  searchUserPortfolio: mocks.searchUserPortfolio,
}));

vi.mock("@/lib/assistant-ai", () => ({
  buildAssistantAiReply: mocks.buildAssistantAiReply,
  classifyAssistantReportSignalWithAi: mocks.classifyAssistantReportSignalWithAi,
  getAssistantAiConnectionStatus: mocks.getAssistantAiConnectionStatus,
  getAssistantAiModelLabel: mocks.getAssistantAiModelLabel,
  getAssistantAiOperationLabel: mocks.getAssistantAiOperationLabel,
}));

vi.mock("@/lib/assistant-agent-tools", () => ({
  executeNoraSimpleRead: mocks.executeNoraSimpleRead,
}));

vi.mock("@/lib/assistant-actions", () => ({
  buildAssistantActionProposalFromPlan: mocks.buildAssistantActionProposalFromPlan,
}));

vi.mock("@/lib/assistant-reports", () => ({
  createAssistantThemeKey: mocks.createAssistantThemeKey,
  listAssistantReports: mocks.listAssistantReports,
  recordAssistantReportSignal: mocks.recordAssistantReportSignal,
}));

vi.mock("@/lib/assistant-guardrails", () => ({
  buildAssistantBlockedReply: mocks.buildAssistantBlockedReply,
  buildGmmPrivacyReply: mocks.buildGmmPrivacyReply,
  evaluateAssistantInput: mocks.evaluateAssistantInput,
  evaluateGmmPrivacy: mocks.evaluateGmmPrivacy,
}));

import { buildAssistantReply } from "@/lib/assistant";
import type { AssistantAiDiagnostic, AssistantReply, AssistantUser } from "@/lib/assistant-types";

const user: AssistantUser = { id: "user-1", role: "ADMIN" };

const localReply: AssistantReply = {
  reply: "Respuesta local",
  sections: [
    {
      title: "Póliza encontrada",
      summary: "Detalle local de la póliza objetivo.",
      items: [
        {
          title: "940454625",
          subtitle: "MARIANO MARTINEZ GRAYEB · Qualitas Compañía de Seguros · AUTO · ACTIVE",
          href: "/policies/policy-1",
          meta: "editar",
        },
      ],
    },
  ],
  quickPrompts: [],
};

const aiTrace = [
  {
    attemptNumber: 1,
    tier: "minimax" as const,
    status: "SUCCEEDED" as const,
    requestedModel: "minimax/minimax-m3",
    finalModel: "minimax/minimax-m3",
    fallbackReason: null,
    code: null,
    durationMs: 420,
    finishReason: "stop",
    statusCode: null,
    usage: {
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      cachedInputTokens: 0,
      estimatedCostUsd: 0.00022,
    },
    responsePreview: null,
  },
  {
    attemptNumber: 2,
    tier: "critical" as const,
    status: "SKIPPED" as const,
    requestedModel: "openai/gpt-5.4-mini",
    finalModel: null,
    fallbackReason: "MiniMax M3 respondió correctamente.",
    code: null,
    durationMs: null,
    finishReason: null,
    statusCode: null,
    usage: null,
    responsePreview: null,
  },
];

function makeDiagnostic(overrides: Partial<AssistantAiDiagnostic> = {}): AssistantAiDiagnostic {
  return {
    diagnosticId: "diag-1",
    operation: "assistant-reply",
    code: "timeout",
    model: "minimax/minimax-m3",
    fallbackModels: ["openai/gpt-5.4-mini"],
    durationMs: 12_345,
    summary: "MiniMax M3 no completó la respuesta: timeout",
    details: "Timeout durante la generación de la respuesta principal.",
    createdAt: new Date().toISOString(),
    statusCode: null,
    finishReason: null,
    responsePreview: null,
    reportId: null,
    ...overrides,
  };
}

describe("assistant router", () => {
  beforeEach(() => {
    mocks.executeNoraSimpleRead.mockResolvedValue({ value: [], toolTrace: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("routes complex policy review prompts to AI and carries context", async () => {
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "revisa la poliza 940454625 busca si ya existe una renovacion relacionada o una coincidencia por cliente aseguradora valida que no duplique otra poliza corrige la fecha de vencimiento",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue(localReply);
    mocks.searchUserPortfolio.mockResolvedValue([
      {
        id: "policy-1",
        type: "policy",
        title: "940454625",
        subtitle: "MARIANO MARTINEZ GRAYEB · Qualitas Compañía de Seguros · AUTO · ACTIVE",
        href: "/policies/policy-1",
        details: ["Vigencia 2025-01-01 a 2026-01-01"],
        match: { field: "policyNumber", fieldLabel: "póliza", snippet: "940454625" },
      },
    ]);
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-1",
        tier: "minimax",
        reply: "IA encontró la póliza y preparó la revisión.",
        sections: localReply.sections,
        quickPrompts: [],
        mutation: null,
        resolvedModel: "minimax/minimax-m3",
        usage: aiTrace[0].usage,
        totalUsage: aiTrace[0].usage,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 420,
        trace: aiTrace,
      },
    });
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.getAssistantAiModelLabel.mockImplementation((model: string) => (model === "minimax/minimax-m3" ? "MiniMax M3" : model));
    mocks.getAssistantAiOperationLabel.mockReturnValue("la respuesta");
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(
      user,
      "Revisa la póliza 940454625, busca si ya existe una renovación relacionada o una coincidencia por cliente/aseguradora, valida que no duplique otra póliza, corrige la fecha de vencimiento al último viernes hábil de este mes y, si hace falta, crea una tarea de seguimiento. Primero dime qué encontraste y luego deja la propuesta lista.",
    );

    expect(response.source).toBe("ai");
    expect(response.reply).toBe("IA encontró la póliza y preparó la revisión.");
    expect(response.aiFallbackNotice).toBeNull();
    expect(response.aiDiagnostic).toBeNull();
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledTimes(1);
    expect(mocks.classifyAssistantReportSignalWithAi).not.toHaveBeenCalled();
    expect(mocks.buildAssistantAiReply.mock.calls[0]?.[0].contextText).toContain("940454625");
    expect(mocks.buildAssistantAiReply.mock.calls[0]?.[0].contextText).toContain("MARIANO MARTINEZ GRAYEB");
    expect(mocks.buildAssistantAiReply.mock.calls[0]?.[0].contextText).toContain("Qualitas Compañía de Seguros");
  });

  it("keeps simple renewal queries on the local path", async () => {
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "dime mis renovaciones a 10 dias",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue({
      reply: "Tienes 1 renovación dentro del rango.",
      sections: [],
      quickPrompts: [],
    });
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.getAssistantAiModelLabel.mockImplementation((model: string) => (model === "minimax/minimax-m3" ? "MiniMax M3" : model));
    mocks.getAssistantAiOperationLabel.mockReturnValue("la respuesta");
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(user, "dime mis renovaciones a 10 dias");

    expect(response.source).toBe("local");
    expect(response.reply).toContain("1 renovación");
    expect(mocks.buildAssistantAiReply).not.toHaveBeenCalled();
  });

  it("records product failure reports locally without waiting for AI", async () => {
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "la captura de pdf no funciona",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue(localReply);
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.createAssistantThemeKey.mockImplementation((parts: Array<string | null>) => parts.filter(Boolean).join("-"));
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-incident-1" });

    const response = await buildAssistantReply(user, "La captura de PDF no funciona");

    expect(response.source).toBe("local");
    expect(response.reportId).toBe("report-incident-1");
    expect(response.reportThemeLabel).toBe("Error en captura de pólizas por PDF");
    expect(mocks.buildAssistantAiReply).not.toHaveBeenCalled();
  });

  it("shows a visible fallback notice when AI cannot answer", async () => {
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "revisa la poliza 940454625",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue(localReply);
    mocks.searchUserPortfolio.mockResolvedValue([]);
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: false,
      diagnostic: makeDiagnostic({
        code: "timeout",
        summary: "MiniMax M3 no completó la respuesta: timeout",
        trace: aiTrace,
      }),
    });
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.getAssistantAiModelLabel.mockImplementation((model: string) => (model === "minimax/minimax-m3" ? "MiniMax M3" : model));
    mocks.getAssistantAiOperationLabel.mockReturnValue("la respuesta");
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(user, "revisa la poliza 940454625");

    expect(response.source).toBe("local");
    expect(response.aiFallbackNotice).toContain("timeout");
    expect(response.aiDiagnostic?.code).toBe("timeout");
    expect(response.reportId).toBe("report-1");
    expect(response.aiDiagnostic?.reportId).toBe("report-1");
  });

  it("falls back to a useful consistency audit when AI times out", async () => {
    const consistencyReply: AssistantReply = {
      reply: "Encontré 1 póliza con fechas o vigencias a revisar.",
      sections: [
        {
          title: "Pólizas con fechas o vigencias a revisar",
          summary: "Fechas de vencimiento, inicio de vigencia o solapes que conviene revisar primero.",
          items: [
            {
              title: "940454625",
              subtitle: "Fechas inconsistentes · Cliente Vencimiento · Qualitas · Vence 2026-07-31",
              href: "/policies/policy-1",
              meta: "critical",
            },
          ],
        },
      ],
      quickPrompts: [],
    };

    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "necesito que me digas que polizas no coinciden sus fechas de vencimiento renovacion inicio de vigencia y sus recibos",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue(consistencyReply);
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: false,
      diagnostic: makeDiagnostic({ code: "timeout", summary: "MiniMax M3 no completó la respuesta: timeout" }),
    });
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(
      user,
      "necesito que me digas que polizas no coinciden sus fechas de vencimiento, renovacion, inicio de vigencia y sus recibos",
    );

    expect(response.source).toBe("local");
    expect(response.reply).toContain("fechas o vigencias");
    expect(response.sections[0]?.title).toBe("Pólizas con fechas o vigencias a revisar");
    expect(response.aiFallbackNotice).toContain("timeout");
    expect(response.aiDiagnostic?.code).toBe("timeout");
  });

  it("keeps an explicitly informational request free of mutation actions", async () => {
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "revisa los recibos vencidos y no modifiques datos",
      reason: "system",
    });
    mocks.buildLocalAssistantReply.mockResolvedValue(localReply);
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-read-only",
        tier: "minimax",
        reply: "Encontré los recibos que requieren revisión.",
        sections: localReply.sections,
        quickPrompts: [],
        mutation: {
          entityType: "policy",
          operation: "update",
          targetQuery: "940454625",
          title: "Cambiar vencimiento",
          summary: "Propuesta que no debe mostrarse.",
          reply: "Confirmar cambio",
          fields: [],
          relations: [],
          missingFields: [],
        },
        resolvedModel: "minimax/minimax-m3",
        usage: aiTrace[0].usage,
        totalUsage: aiTrace[0].usage,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 420,
        trace: aiTrace,
      },
    });
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
    mocks.getAssistantAiModelLabel.mockImplementation((model: string) => model);
    mocks.getAssistantAiOperationLabel.mockReturnValue("la respuesta");
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-read-only" });

    const response = await buildAssistantReply(user, "Revisa los recibos vencidos y no modifiques datos");

    expect(response.actionProposal).toBeNull();
    expect(response.sections).toEqual([]);
    expect(mocks.buildAssistantActionProposalFromPlan).not.toHaveBeenCalled();
  });

  it("uses Luna as the agent orchestrator with recent history when enabled", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "all");
    vi.stubEnv("DATABASE_URL", "");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "lista los siniestros abiertos y sus pendientes",
      reason: "system",
    });
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-agent",
        tier: "minimax",
        reply: "Encontré dos siniestros abiertos.",
        sections: [],
        quickPrompts: [],
        mutation: null,
        actionProposal: null,
        toolTrace: [{ tool: "listClaims", outcome: "success", durationMs: 12 }],
        promptVersion: "nora-agent-v1",
        resolvedModel: "openai/gpt-5.6-luna",
        usage: aiTrace[0].usage,
        totalUsage: aiTrace[0].usage,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 420,
        trace: aiTrace,
      },
    });
    mocks.executeNoraSimpleRead.mockResolvedValue({
      value: [{ id: "claim-1", folio: "SIN-001", status: "OPEN", metadataOnly: true }],
      toolTrace: [{ tool: "listClaims", outcome: "success", durationMs: 12 }],
    });
    const history = [
      { role: "user" as const, content: "Busca mis siniestros" },
      { role: "assistant" as const, content: "¿Abiertos o todos?" },
    ];

    const response = await buildAssistantReply(user, "Lista los siniestros abiertos y sus pendientes", { history });

    expect(response.source).toBe("ai");
    expect(response.aiPromptVersion).toBe("nora-agent-v1");
    expect(response.aiToolTrace).toEqual([{ tool: "listClaims", outcome: "success", durationMs: 12 }]);
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledWith(expect.objectContaining({
      mode: "conversation",
      history,
      contextText: expect.stringContaining('"folio":"SIN-001"'),
      precomputedToolTrace: [{ tool: "listClaims", outcome: "success", durationMs: 12 }],
    }));
    expect(mocks.executeNoraSimpleRead).toHaveBeenCalledTimes(1);
    expect(mocks.buildAssistantAiReply.mock.calls[0]?.[0].activeTools).toBeUndefined();
    expect(mocks.buildAssistantAiReply.mock.calls[0]?.[0].requiredTool).toBeNull();
    expect(mocks.buildLocalAssistantReply).not.toHaveBeenCalled();
  });

  it("routes a natural-language today summary to the same safe read capability as the quick action", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "admin");
    vi.stubEnv("DATABASE_URL", "");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "dame el resumen de hoy",
      reason: "system",
    });
    mocks.executeNoraSimpleRead.mockResolvedValue({
      value: [{ title: "Resumen de hoy" }],
      toolTrace: [{ tool: "getTodayBrief", outcome: "success", durationMs: 10 }],
      knowledgeCitations: [],
    });
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-today",
        tier: "minimax",
        reply: "Resumen autorizado de hoy.",
        sections: [],
        quickPrompts: [],
        mutation: null,
        actionProposal: null,
        toolTrace: [{ tool: "getTodayBrief", outcome: "success", durationMs: 10 }],
        promptVersion: "nora-agent-v1",
        executionProfile: "simple-read",
        stepCount: 1,
        terminationReason: "complete",
        resolvedModel: "alibaba/qwen3.7-flash",
        usage: null,
        totalUsage: null,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 100,
        trace: [],
      },
    });

    const response = await buildAssistantReply(user, "Dame el resumen de hoy.");

    expect(response.source).toBe("ai");
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledWith(expect.objectContaining({
      mode: "conversation",
      executionProfile: "simple-read",
      contextText: expect.stringContaining('Resultado autorizado de getTodayBrief'),
      activeTools: undefined,
      requiredTool: null,
      precomputedToolTrace: [{ tool: "getTodayBrief", outcome: "success", durationMs: 10 }],
    }));
    expect(mocks.executeNoraSimpleRead).toHaveBeenCalledTimes(1);
  });

  it("lets the agent reformulate a knowledge question instead of precomputing one exact local search", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "admin");
    vi.stubEnv("DATABASE_URL", "");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "que suele cubrir un seguro de auto",
      reason: "system",
    });
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-knowledge-agent",
        tier: "minimax",
        reply: "La cobertura depende del paquete contratado; revisa la póliza vigente.",
        sections: [],
        quickPrompts: [],
        mutation: null,
        actionProposal: null,
        toolTrace: [{ tool: "searchKnowledgeBase", outcome: "success", durationMs: 18 }],
        knowledgeCitations: [{ sourceId: "auto-general-1", sourceType: "GENERAL", title: "Seguro de Auto", version: "2026-08-17", sourceUrl: null, authority: "Demo", reviewedAt: null, page: null, section: "Flujo operativo" }],
        promptVersion: "nora-agent-v4",
        executionProfile: "simple-read",
        stepCount: 2,
        terminationReason: "complete",
        resolvedModel: "alibaba/qwen3.7-flash",
        usage: null,
        totalUsage: null,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 420,
        trace: [],
      },
    });

    const response = await buildAssistantReply(user, "¿Qué suele cubrir un seguro de Auto?");

    expect(response.source).toBe("ai");
    expect(mocks.executeNoraSimpleRead).not.toHaveBeenCalled();
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledWith(expect.objectContaining({
      mode: "agent",
      executionProfile: "simple-read",
      activeTools: ["searchKnowledgeBase"],
      requiredTool: "searchKnowledgeBase",
    }));
  });

  it("routes an explicit draft request through structured Luna even when the agent is enabled", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "all");
    vi.stubEnv("DATABASE_URL", "");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "actualiza el telefono de alejandro ramos a 5550101234 solo prepara el borrador no ejecutes nada",
      reason: "system",
    });
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-draft",
        tier: "critical",
        reply: "Preparé un borrador para actualizar el teléfono.",
        sections: [],
        quickPrompts: [],
        mutation: {
          entityType: "client",
          operation: "update",
          targetQuery: "Alejandro Ramos",
          title: "Actualizar teléfono",
          summary: "Cambiar teléfono del cliente.",
          reply: "El borrador requiere confirmación.",
          fields: [{ field: "phone", label: "Teléfono", value: "5550101234" }],
          relations: [],
          missingFields: [],
        },
        actionProposal: null,
        toolTrace: [],
        promptVersion: null,
        executionProfile: "draft",
        stepCount: 1,
        terminationReason: "complete",
        resolvedModel: "alibaba/qwen3.7-flash",
        usage: aiTrace[0].usage,
        totalUsage: aiTrace[0].usage,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 420,
        trace: aiTrace,
      },
    });
    mocks.buildAssistantActionProposalFromPlan.mockResolvedValue({ draftId: "draft-1" });

    const response = await buildAssistantReply(user, "Actualiza el teléfono de Alejandro Ramos a 5550101234. Solo prepara el borrador, no ejecutes nada.");

    expect(response.actionProposal).toEqual({ draftId: "draft-1" });
    expect(response.aiExecutionProfile).toBe("draft");
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledWith(expect.objectContaining({
      mode: "structured",
      executionProfile: "draft",
    }));
    expect(mocks.buildAssistantActionProposalFromPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps GMM medical narrative local and never sends it to Luna", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "all");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "el diagnostico fue diabetes y lo atendio la dra perez",
      reason: "system",
    });
    mocks.evaluateGmmPrivacy.mockReturnValue({ allowed: false, hasSensitiveNarrative: true, isMetadataAction: false });
    mocks.buildGmmPrivacyReply.mockReturnValue("Usa únicamente metadatos del checklist de GMM.");

    const response = await buildAssistantReply(
      user,
      "El diagnóstico fue diabetes y lo atendió la Dra. Pérez",
      { gmmMetadataOnly: true },
    );

    expect(response.source).toBe("local");
    expect(response.reply).toContain("metadatos");
    expect(mocks.buildAssistantAiReply).not.toHaveBeenCalled();
    expect(mocks.buildLocalAssistantReply).not.toHaveBeenCalled();
  });

  it("removes medical GMM history before calling Luna", async () => {
    vi.stubEnv("NORA_AGENT_MODE", "all");
    vi.stubEnv("DATABASE_URL", "");
    mocks.evaluateAssistantInput.mockReturnValue({
      allowed: true,
      normalized: "ver requisitos faltantes del checklist",
      reason: "system",
    });
    mocks.evaluateGmmPrivacy.mockImplementation((content: string) => {
      const sensitive = /diagnóstico reservado|resonancia privada|doctor privado|archivo-clinico\.pdf/i.test(content);
      return { allowed: !sensitive, hasSensitiveNarrative: sensitive, isMetadataAction: !sensitive };
    });
    mocks.buildAssistantAiReply.mockResolvedValue({
      ok: true,
      value: {
        runId: "run-gmm-safe",
        tier: "minimax",
        reply: "Falta un requisito.",
        quickPrompts: [],
        mutation: null,
        actionProposal: null,
        toolTrace: [],
        promptVersion: "nora-agent-v1",
        resolvedModel: "openai/gpt-5.6-luna",
        usage: null,
        totalUsage: null,
        finishReason: "stop",
        providerMetadata: {},
        durationMs: 100,
        trace: [],
      },
    });
    const history = [
      { role: "user" as const, content: "Diagnóstico reservado" },
      { role: "user" as const, content: "Resonancia privada" },
      { role: "user" as const, content: "Doctor Privado" },
      { role: "user" as const, content: "archivo-clinico.pdf" },
      { role: "assistant" as const, content: "Usa el checklist de metadatos" },
    ];

    const response = await buildAssistantReply(user, "Ver requisitos faltantes del checklist", {
      gmmMetadataOnly: true,
      history,
    });

    expect(response.source).toBe("ai");
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledWith(expect.objectContaining({
      history: [{ role: "assistant", content: "Usa el checklist de metadatos" }],
      gmmMetadataOnly: true,
    }));
    const gatewayInput = JSON.stringify(mocks.buildAssistantAiReply.mock.calls[0]?.[0]);
    expect(gatewayInput).not.toContain("Diagnóstico reservado");
    expect(gatewayInput).not.toContain("Resonancia privada");
    expect(gatewayInput).not.toContain("Doctor Privado");
    expect(gatewayInput).not.toContain("archivo-clinico.pdf");
  });
});
