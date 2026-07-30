import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  buildLocalAssistantReply: vi.fn(),
  getLocalAssistantHomeSnapshot: vi.fn(),
  searchUserPortfolio: vi.fn(),
  buildAssistantAiReply: vi.fn(),
  classifyAssistantReportSignalWithAi: vi.fn(),
  getAssistantAiConnectionStatus: vi.fn(),
  getAssistantAiModelLabel: vi.fn(),
  getAssistantAiOperationLabel: vi.fn(),
  buildAssistantActionProposalFromPlan: vi.fn(),
  createAssistantThemeKey: vi.fn(),
  listAssistantReports: vi.fn(),
  recordAssistantReportSignal: vi.fn(),
  buildAssistantBlockedReply: vi.fn(),
  evaluateAssistantInput: vi.fn(),
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
  evaluateAssistantInput: mocks.evaluateAssistantInput,
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
});
