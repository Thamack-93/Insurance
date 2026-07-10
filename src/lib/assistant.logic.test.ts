import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  buildLocalAssistantReply: vi.fn(),
  getLocalAssistantHomeSnapshot: vi.fn(),
  searchUserPortfolio: vi.fn(),
  buildAssistantAiReply: vi.fn(),
  classifyAssistantReportSignalWithAi: vi.fn(),
  getAssistantAiConnectionStatus: vi.fn(),
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
import type { AssistantReply, AssistantUser } from "@/lib/assistant-types";

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
      reply: "IA encontró la póliza y preparó la revisión.",
      sections: localReply.sections,
      quickPrompts: [],
      mutation: null,
    });
    mocks.classifyAssistantReportSignalWithAi.mockResolvedValue(null);
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-4o-mini"],
    });
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(
      user,
      "Revisa la póliza 940454625, busca si ya existe una renovación relacionada o una coincidencia por cliente/aseguradora, valida que no duplique otra póliza, corrige la fecha de vencimiento al último viernes hábil de este mes y, si hace falta, crea una tarea de seguimiento. Primero dime qué encontraste y luego deja la propuesta lista.",
    );

    expect(response.source).toBe("ai");
    expect(response.reply).toBe("IA encontró la póliza y preparó la revisión.");
    expect(response.aiFallbackNotice).toBeNull();
    expect(mocks.buildAssistantAiReply).toHaveBeenCalledTimes(1);
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
      fallbackModels: ["openai/gpt-4o-mini"],
    });
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(user, "dime mis renovaciones a 10 dias");

    expect(response.source).toBe("local");
    expect(response.reply).toContain("1 renovación");
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
    mocks.buildAssistantAiReply.mockResolvedValue(null);
    mocks.classifyAssistantReportSignalWithAi.mockResolvedValue(null);
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-4o-mini"],
    });
    mocks.listAssistantReports.mockResolvedValue([]);
    mocks.recordAssistantReportSignal.mockResolvedValue({ id: "report-1" });

    const response = await buildAssistantReply(user, "revisa la poliza 940454625");

    expect(response.source).toBe("local");
    expect(response.aiFallbackNotice).toContain("Intenté usar IA");
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
    mocks.buildAssistantAiReply.mockResolvedValue(null);
    mocks.classifyAssistantReportSignalWithAi.mockResolvedValue(null);
    mocks.getAssistantAiConnectionStatus.mockReturnValue({
      available: true,
      authMode: "api-key",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-4o-mini"],
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
    expect(response.aiFallbackNotice).toContain("Intenté usar IA");
  });
});
