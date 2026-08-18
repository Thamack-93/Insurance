import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getGenerationInfo: vi.fn(),
  createRun: vi.fn(),
  createAttempt: vi.fn(),
  finalizeAttempt: vi.fn(),
  finalizeRun: vi.fn(),
  stepCountIs: vi.fn(),
}));

const MockToolLoopAgent = vi.hoisted(() => class {
  private readonly settings: Record<string, unknown>;

  constructor(settings: Record<string, unknown>) {
    this.settings = settings;
  }

  generate(options: Record<string, unknown>) {
    const prepareStep = this.settings.prepareStep as ((input: Record<string, unknown>) => unknown) | undefined;
    const prepared = prepareStep?.({
      stepNumber: 0,
      steps: [],
      model: this.settings.model,
      messages: options.messages ?? [],
      experimental_context: undefined,
    });
    return Promise.resolve(prepared).then((step) => aiMocks.generateText({
      ...this.settings,
      ...(step && typeof step === "object" ? step : {}),
      system: this.settings.instructions,
      ...options,
    }));
  }

  async stream(options: Record<string, unknown>) {
    const generated = await this.generate(options) as Record<string, unknown>;
    const fullStream = generated.fullStream ?? (async function* () {
      yield { type: "text-delta", text: generated.text ?? "" };
    })();
    return {
      fullStream,
      text: Promise.resolve(generated.text ?? ""),
      usage: Promise.resolve(generated.usage ?? null),
      totalUsage: Promise.resolve(generated.totalUsage ?? generated.usage ?? null),
      providerMetadata: Promise.resolve(generated.providerMetadata ?? undefined),
      finishReason: Promise.resolve(generated.finishReason ?? "stop"),
      steps: Promise.resolve(generated.steps ?? []),
    };
  }
});

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  const gateway = Object.assign((model: string) => model, { getGenerationInfo: aiMocks.getGenerationInfo });
  return {
    ...actual,
    generateText: aiMocks.generateText,
    ToolLoopAgent: MockToolLoopAgent,
    gateway,
    stepCountIs: (count: number) => {
      aiMocks.stepCountIs(count);
      return actual.stepCountIs(count);
    },
  };
});

vi.mock("@/lib/assistant-ai-runs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assistant-ai-runs")>("@/lib/assistant-ai-runs");
  return {
    ...actual,
    createAssistantAiRun: aiMocks.createRun,
    createAssistantAiAttempt: aiMocks.createAttempt,
    finalizeAssistantAiAttempt: aiMocks.finalizeAttempt,
    finalizeAssistantAiRun: aiMocks.finalizeRun,
  };
});

vi.mock("server-only", () => ({}));
import {
  buildAssistantAiReply,
  extractPolicyPdfDraftFromAiFile,
  reviewPolicyPdfWithAi,
  getAssistantAiConnectionStatus,
  getAssistantAiModel,
  getAssistantGatewayAuthMode,
  getAssistantGatewayFallbackModels,
  assistantAgentOutputBudgetReached,
  getAssistantAiRuntimeLimits,
} from "@/lib/assistant-ai";
import type { AssistantUser } from "@/lib/assistant-types";

const trackedDraft = {
  policyNumber: "1009578", clientName: "CLIENTE DEMO", clientType: "PERSON" as const, clientEmail: null, clientPhone: null,
  clientAddress: null, clientRfc: null, clientBirthDate: null, insurerName: "Seguros Banorte, S.A. de C.V.", policyType: "AUTO",
  serialNumber: null, startDate: "2026-08-01", endDate: "2027-08-01", issueDate: null, paymentFrequency: "ANNUAL",
  paymentPlan: null, premiumAmount: 10, currency: "MXN", requestNumber: null, insuredObject: null, beneficiaryInfo: null,
  notes: null, sourcePolicyNumber: null,
};

describe("assistant ai fallback", () => {
  beforeEach(() => {
    aiMocks.finalizeAttempt.mockResolvedValue({});
    aiMocks.finalizeRun.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns null when the AI gateway is not configured", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");

    const user: AssistantUser = { id: "agent-1", role: "AGENT", organizationId: "org-test" };
    const reply = await buildAssistantAiReply({
      user,
      message: "hola",
      localReply: {
        reply: "Resumen local",
        sections: [],
        quickPrompts: [],
      },
    });

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.diagnostic.code).toBe("unavailable");
      expect(reply.diagnostic.summary).toContain("no está disponible");
    }
  });

  it("uses a configurable model with the Qwen 3.7 Flash primary default", () => {
    vi.stubEnv("AI_GATEWAY_MODEL", "minimax/minimax-m3");
    expect(getAssistantAiModel()).toBe("alibaba/qwen3.7-flash");

    vi.stubEnv("AI_GATEWAY_MODEL", "invalid-model");
    expect(getAssistantAiModel()).toBe("alibaba/qwen3.7-flash");
  });

  it("prefers API key when both supported credentials exist", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");

    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");
  });

  it("defaults to the Qwen fallback chain and supports disabling paid fallbacks", () => {
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "");
    expect(getAssistantGatewayFallbackModels()).toEqual(["deepseek/deepseek-v4-flash-0731", "openai/gpt-5.4-nano"]);

    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    expect(getAssistantGatewayFallbackModels()).toEqual([]);

    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "openai/gpt-5.4-mini, deepseek/deepseek-v3");
    expect(getAssistantGatewayFallbackModels()).toEqual(["openai/gpt-5.4-mini", "deepseek/deepseek-v3"]);

    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "minimax/minimax-m3, deepseek/deepseek-v4-flash-0731, openai/gpt-5.4-nano");
    expect(getAssistantGatewayFallbackModels()).toEqual(["deepseek/deepseek-v4-flash-0731", "openai/gpt-5.4-nano"]);
  });

  it("configures the agent from the selected model with the stable prompt, safe tools and four-step limit", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText.mockResolvedValue({
      text: "Resumen generado por Nora.",
      usage: { inputTokens: 1_500, outputTokens: 100 },
      totalUsage: { inputTokens: 1_500, outputTokens: 100 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash" } },
      finishReason: "stop",
    });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Lista los siniestros abiertos",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      contextText: "claim SIN-001",
      history: [{ role: "user", content: "Busca el siniestro SIN-001" }],
      mode: "agent",
    });

    expect(result.ok).toBe(true);
    expect(aiMocks.stepCountIs).toHaveBeenCalledWith(4);
    const options = aiMocks.generateText.mock.calls[0]?.[0];
    expect(options.model).toBe("alibaba/qwen3.7-flash");
    expect(options.maxRetries).toBe(0);
    expect(options.maxOutputTokens).toBe(12_288);
    expect(options.stopWhen).toHaveLength(2);
    expect(options.system.length).toBeGreaterThan(4_096);
    expect(Object.keys(options.tools)).toEqual([
      "searchPortfolio",
      "searchKnowledgeBase",
      "getEntitySummary",
      "getTodayBrief",
      "listRenewals",
      "listReceipts",
      "listOpenWorkItems",
      "listClaims",
      "getClaimChecklist",
      "auditConsistency",
      "prepareActionDraft",
    ]);
    expect(options.messages).toEqual([
      { role: "user", content: "Busca el siniestro SIN-001" },
      { role: "user", content: "Contexto explícito autorizado: claim SIN-001\n\nLista los siniestros abiertos" },
    ]);
    expect(options.providerOptions.gateway.tags).toContain("prompt:nora-agent-v1");
  });

  it("passes bounded Qwen thinking options only to the Alibaba model", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText.mockResolvedValue({
      text: "Resumen generado por Nora.",
      usage: { inputTokens: 100, outputTokens: 20 },
      totalUsage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash" } },
      finishReason: "stop",
    });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen de hoy",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
    });

    expect(result.ok).toBe(true);
    const options = aiMocks.generateText.mock.calls[0]?.[0];
    expect(options.providerOptions.alibaba).toEqual({ enableThinking: true, thinkingBudget: 8_192 });
    expect(options.providerOptions.gateway.models).toEqual([]);
    expect(options.maxRetries).toBe(0);
  });

  it("uses a smaller simple-read profile and forces the requested first tool", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText.mockResolvedValue({
      text: "Resumen generado por Nora.",
      usage: { inputTokens: 100, outputTokens: 20 },
      totalUsage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash" } },
      finishReason: "stop",
    });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen de hoy",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "simple-read",
      activeTools: ["getTodayBrief"],
      requiredTool: "getTodayBrief",
    });

    expect(result.ok).toBe(true);
    expect(aiMocks.stepCountIs).toHaveBeenCalledWith(2);
    const options = aiMocks.generateText.mock.calls[0]?.[0];
    expect(options.maxOutputTokens).toBe(4_096);
    expect(options.providerOptions.alibaba).toEqual({ enableThinking: false });
    expect(options.activeTools).toEqual(["getTodayBrief"]);
    expect(options.toolChoice).toEqual({ type: "tool", toolName: "getTodayBrief" });
    expect(options.providerOptions.alibaba.enableThinking).toBe(false);
  });

  it("uses progress and emergency guards instead of the former 14/25 second deadlines", () => {
    vi.stubEnv("NORA_AI_IDLE_TIMEOUT_MS", "");
    vi.stubEnv("NORA_AI_EMERGENCY_TIMEOUT_MS", "");

    expect(getAssistantAiRuntimeLimits()).toEqual({
      idleTimeoutMs: 120_000,
      emergencyTimeoutMs: 240_000,
      nonStreamingAttemptTimeoutMs: 120_000,
    });
  });

  it("falls back only after a streamed agent stops emitting progress", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "deepseek/deepseek-v4-flash");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NORA_AI_IDLE_TIMEOUT_MS", "30000");
    vi.stubEnv("NORA_AI_EMERGENCY_TIMEOUT_MS", "60000");
    aiMocks.generateText
      .mockImplementationOnce((options: { abortSignal?: AbortSignal }) => ({
        text: "",
        usage: null,
        totalUsage: null,
        providerMetadata: null,
        finishReason: "stop",
        fullStream: (async function* () {
          await new Promise<void>((_resolve, reject) => {
            const rejectForAbort = () => reject(options.abortSignal?.reason ?? new DOMException("Aborted", "AbortError"));
            if (options.abortSignal?.aborted) rejectForAbort();
            else options.abortSignal?.addEventListener("abort", rejectForAbort, { once: true });
          });
          if (false) yield null;
        })(),
      }))
      .mockResolvedValueOnce({
        text: "Respuesta de fallback",
        usage: { inputTokens: 100, outputTokens: 20 },
        totalUsage: { inputTokens: 100, outputTokens: 20 },
        providerMetadata: { gateway: { model: "deepseek/deepseek-v4-flash" } },
        finishReason: "stop",
      });

    const resultPromise = buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen de hoy",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "simple-read",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: true,
      value: {
        resolvedModel: "deepseek/deepseek-v4-flash",
        trace: [
          expect.objectContaining({ requestedModel: "alibaba/qwen3.7-flash", code: "timeout" }),
          expect.objectContaining({ requestedModel: "deepseek/deepseek-v4-flash", status: "SUCCEEDED" }),
        ],
      },
    });
  });

  it("keeps a long agent attempt alive while streamed progress continues", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NORA_AI_IDLE_TIMEOUT_MS", "30000");
    vi.stubEnv("NORA_AI_EMERGENCY_TIMEOUT_MS", "60000");
    aiMocks.generateText.mockResolvedValue({
      text: "Respuesta larga completa",
      usage: { inputTokens: 100, outputTokens: 20 },
      totalUsage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash" } },
      finishReason: "stop",
      fullStream: (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        yield { type: "reasoning-delta", text: "progreso" };
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        yield { type: "text-delta", text: "respuesta" };
      })(),
    });

    const resultPromise = buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Analiza una consulta extensa",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "complex-read",
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ ok: true, value: { reply: "Respuesta larga completa" } });
  });

  it("rejects truncated responses without presenting partial text", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText.mockResolvedValue({
      text: "Respuesta incompleta",
      usage: { inputTokens: 100, outputTokens: 4_096 },
      totalUsage: { inputTokens: 100, outputTokens: 4_096 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash" } },
      finishReason: "length",
    });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen de hoy",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "simple-read",
    });

    expect(result).toMatchObject({ ok: false, diagnostic: { code: "incomplete_output" } });
  });

  it("passes disabled reasoning options to DeepSeek and GPT Nano fallbacks", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "deepseek/deepseek-v4-flash-0731,openai/gpt-5.4-nano");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText
      .mockRejectedValueOnce(new Error("Qwen unavailable"))
      .mockRejectedValueOnce(new Error("DeepSeek unavailable"))
      .mockResolvedValueOnce({
        text: "Respuesta de Nano",
        usage: { inputTokens: 10, outputTokens: 5 },
        totalUsage: { inputTokens: 10, outputTokens: 5 },
        providerMetadata: { gateway: { model: "openai/gpt-5.4-nano" } },
        finishReason: "stop",
      });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen autorizado.",
      localReply: { reply: "Resumen local", sections: [], quickPrompts: [] },
      mode: "conversation",
      executionProfile: "simple-read",
    });

    expect(result.ok).toBe(true);
    expect(aiMocks.generateText.mock.calls[1]?.[0].providerOptions.deepseek).toEqual({ thinking: { type: "disabled" } });
    expect(aiMocks.generateText.mock.calls[2]?.[0].providerOptions.openai).toEqual({ reasoningEffort: "none" });
  });

  it("does not start a third model for a complex agent after Qwen and DeepSeek fail", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "deepseek/deepseek-v4-flash-0731,openai/gpt-5.4-nano");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.generateText
      .mockRejectedValueOnce(new Error("Qwen unavailable"))
      .mockRejectedValueOnce(new Error("DeepSeek unavailable"));

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Analiza inconsistencias complejas de mi cartera.",
      localReply: { reply: "Resumen local", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "complex-read",
    });

    expect(result.ok).toBe(false);
    expect(aiMocks.generateText).toHaveBeenCalledTimes(2);
    expect(aiMocks.generateText.mock.calls.map((call) => call[0].model)).toEqual([
      "alibaba/qwen3.7-flash",
      "deepseek/deepseek-v4-flash-0731",
    ]);
  });

  it("looks up Gateway usage once when usage and totalUsage share a generation", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "alibaba/qwen3.7-flash");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "none");
    vi.stubEnv("DATABASE_URL", "");
    aiMocks.getGenerationInfo.mockResolvedValue({
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 60,
      cacheCreationTokens: 10,
      totalCost: 0.00001,
    });
    aiMocks.generateText.mockResolvedValue({
      text: "Respuesta completa",
      usage: { inputTokens: 100, outputTokens: 20 },
      totalUsage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { gateway: { model: "alibaba/qwen3.7-flash", generationId: "gen-1" } },
      finishReason: "stop",
    });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame el resumen de hoy",
      localReply: { reply: "", sections: [], quickPrompts: [] },
      mode: "agent",
      executionProfile: "simple-read",
    });

    expect(result.ok).toBe(true);
    expect(aiMocks.getGenerationInfo).toHaveBeenCalledTimes(1);
    expect(result.ok && result.value.totalUsage).toMatchObject({ cacheReadTokens: 60, cacheWriteTokens: 10 });
  });

  it("stops the agent before starting another step after the aggregate output budget", () => {
    expect(assistantAgentOutputBudgetReached({
      steps: [
        { usage: { outputTokens: 16_000 } } as never,
        { usage: { outputTokens: 16_768 } } as never,
      ] as never,
    })).toBe(true);
    expect(assistantAgentOutputBudgetReached({
      steps: [{ usage: { outputTokenDetails: { textTokens: 2_000, reasoningTokens: 4_000 } } } as never] as never,
    })).toBe(false);
  });

  it("treats a Vercel deployment as gateway-capable even without a local token", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL", "1");

    expect(getAssistantAiConnectionStatus()).toEqual({
      available: true,
      authMode: "deployment",
      connectionState: "configured",
      model: "alibaba/qwen3.7-flash",
      fallbackModels: ["deepseek/deepseek-v4-flash-0731", "openai/gpt-5.4-nano"],
    });
  });

  it("reports a PDF review as unavailable when credentials are absent", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "");

    const result = await reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      draft: {
        policyNumber: "1009578",
        clientName: "CLIENTE DEMO",
        clientType: "COMPANY",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        clientBirthDate: null,
        insurerName: "Seguros Banorte, S.A. de C.V.",
        policyType: "AUTO",
        serialNumber: "1G1F66S0XN4124102",
        startDate: "2026-08-01",
        endDate: "2027-08-01",
        issueDate: null,
        paymentFrequency: "ANNUAL",
        paymentPlan: null,
        premiumAmount: 31920.29,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
      warnings: ["Revisar"],
    });

    expect(result).toEqual({ value: null, runId: null, trackingStatus: "unavailable", attempted: false });
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it("records successful PDF review usage without storing the PDF text as evidence", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://disposable");
    aiMocks.createRun.mockResolvedValue({ id: "run-review-1" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt-review-1" });
    aiMocks.getGenerationInfo.mockResolvedValue({ promptTokens: 10, completionTokens: 20, totalCost: 0.000012 });
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 10, outputTokens: 20 },
      totalUsage: { inputTokens: 10, outputTokens: 20 },
      providerMetadata: { gateway: { generationId: "gen-review-1" } },
      finishReason: "stop",
      text: "PII del PDF que no debe ir a evidencia",
    });

    const result = await reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      text: "NOMBRE PRIVADO Y DATOS DEL PDF",
      draft: {
        policyNumber: "1009578", clientName: "CLIENTE DEMO", clientType: "PERSON", clientEmail: null, clientPhone: null,
        clientAddress: null, clientRfc: null, clientBirthDate: null, insurerName: "Seguros Banorte, S.A. de C.V.",
        policyType: "AUTO", serialNumber: null, startDate: "2026-08-01", endDate: "2027-08-01", issueDate: null,
        paymentFrequency: "ANNUAL", paymentPlan: null, premiumAmount: 10, currency: "MXN", requestNumber: null,
        insuredObject: null, beneficiaryInfo: null, notes: null, sourcePolicyNumber: null,
      },
      warnings: ["Revisar"],
    });

    const runId = aiMocks.createRun.mock.calls[0]?.[0].id;
    const attemptId = aiMocks.createAttempt.mock.calls[0]?.[0].id;
    expect(result).toMatchObject({ value: { summary: "Revisión completada" }, runId, trackingStatus: "recorded", attempted: true });
    expect(aiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ id: runId, operation: "policy-pdf-review" }));
    expect(aiMocks.createAttempt).toHaveBeenCalledWith(expect.objectContaining({ runId, status: "STARTED" }));
    expect(aiMocks.finalizeAttempt).toHaveBeenCalledWith(attemptId, expect.objectContaining({ status: "SUCCEEDED", responsePreview: "Policy PDF review completed.", usage: expect.objectContaining({ generationId: "gen-review-1", inputTokens: 10, outputTokens: 20 }) }));
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "SUCCEEDED", responsePreview: "Policy PDF review completed.", finalModel: "alibaba/qwen3.7-flash" }));
    expect(aiMocks.generateText.mock.calls.map((call) => call[0].providerOptions.gateway.models)).toEqual([[]]);
    expect(JSON.stringify(aiMocks.finalizeAttempt.mock.calls)).not.toContain("NOMBRE PRIVADO");
  });

  it("records successful PDF extraction usage as a separate operation", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://disposable");
    aiMocks.createRun.mockResolvedValue({ id: "run-extract-1" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt-extract-1" });
    aiMocks.getGenerationInfo.mockResolvedValue({ promptTokens: 12, completionTokens: 24, totalCost: 0.00002 });
    aiMocks.generateText.mockResolvedValue({
      output: {
        draft: trackedDraft,
        fieldConfidence: {
          policyNumber: "high", clientName: "high", clientType: "high", clientEmail: "low", clientPhone: "low",
          clientAddress: "medium", clientRfc: "medium", clientBirthDate: "low", insurerName: "high", policyType: "high",
          serialNumber: "medium", startDate: "high", endDate: "high", issueDate: "medium", paymentFrequency: "high",
          premiumAmount: "high", sourcePolicyNumber: "low",
        },
        warnings: [],
        aiReview: { summary: "Extracción revisable", warnings: [], suggestions: [], corrections: [] },
      },
      usage: { inputTokens: 12, outputTokens: 24 },
      totalUsage: { inputTokens: 12, outputTokens: 24 },
      providerMetadata: { gateway: { generationId: "gen-extract-1" } },
      finishReason: "stop",
      text: "No debe persistirse el contenido del PDF",
    });

    const result = await extractPolicyPdfDraftFromAiFile({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      fileName: "poliza.pdf",
      fileData: new Uint8Array([37, 80, 68, 70]),
    });

    const runId = aiMocks.createRun.mock.calls[0]?.[0].id;
    const attemptId = aiMocks.createAttempt.mock.calls[0]?.[0].id;
    expect(result).toMatchObject({ value: { draft: trackedDraft }, runId, trackingStatus: "recorded", attempted: true });
    expect(aiMocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ id: runId, operation: "policy-pdf-extract" }));
    expect(aiMocks.finalizeAttempt).toHaveBeenCalledWith(attemptId, expect.objectContaining({
      status: "SUCCEEDED",
      usage: expect.objectContaining({ generationId: "gen-extract-1", inputTokens: 12, outputTokens: 24 }),
    }));
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "SUCCEEDED", finalModel: "alibaba/qwen3.7-flash" }));
    expect(aiMocks.generateText.mock.calls.map((call) => call[0].providerOptions.gateway.models)).toEqual([[]]);
    expect(JSON.stringify(aiMocks.finalizeAttempt.mock.calls)).not.toContain("No debe persistirse");
  });

  it("keeps the model actually served by Gateway in the audit", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://disposable");
    aiMocks.createRun.mockResolvedValue({ id: "run-resolved-model" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt-resolved-model" });
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 4, outputTokens: 5 },
      totalUsage: { inputTokens: 4, outputTokens: 5 },
      providerMetadata: { gateway: { generationId: "gen-resolved-model", model: "minimax/minimax-m3" } },
      finishReason: "stop",
      text: "",
    });

    const result = await reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      draft: trackedDraft,
      warnings: [],
    });

    const runId = aiMocks.createRun.mock.calls[0]?.[0].id;
    const attemptId = aiMocks.createAttempt.mock.calls[0]?.[0].id;
    expect(result).toMatchObject({ value: { summary: "Revisión completada" }, runId, trackingStatus: "recorded" });
    expect(aiMocks.finalizeAttempt).toHaveBeenCalledWith(attemptId, expect.objectContaining({ finalModel: "minimax/minimax-m3" }));
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ finalModel: "minimax/minimax-m3" }));
  });

  it("records failed PDF review attempts and preserves the failure status", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://disposable");
    aiMocks.createRun.mockResolvedValue({ id: "run-review-2" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt-review-2" });
    aiMocks.generateText.mockRejectedValue(new Error("gateway failed with private context"));

    const result = await reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      draft: {
        policyNumber: "1009578", clientName: "CLIENTE DEMO", clientType: "PERSON", clientEmail: null, clientPhone: null,
        clientAddress: null, clientRfc: null, clientBirthDate: null, insurerName: "Seguros Banorte, S.A. de C.V.",
        policyType: "AUTO", serialNumber: null, startDate: "", endDate: "", issueDate: null, paymentFrequency: "ANNUAL",
        paymentPlan: null, premiumAmount: 0, currency: "MXN", requestNumber: null, insuredObject: null, beneficiaryInfo: null,
        notes: null, sourcePolicyNumber: null,
      },
      warnings: ["Revisar"],
    });

    const runId = aiMocks.createRun.mock.calls[0]?.[0].id;
    const attemptId = aiMocks.createAttempt.mock.calls[0]?.[0].id;
    expect(result).toMatchObject({ value: null, runId, trackingStatus: "recorded", attempted: true });
    expect(aiMocks.finalizeAttempt).toHaveBeenCalledWith(attemptId, expect.objectContaining({ status: "FAILED", responsePreview: null }));
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "FAILED", attemptCount: 3, fallbackCount: 2, errorCode: "provider_unavailable" }));
  });

  it("does not block the gateway when creating the audit run times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://unresponsive");
    aiMocks.createRun.mockImplementation(() => new Promise(() => {}));
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      providerMetadata: null,
      finishReason: "stop",
      text: "",
    });

    const resultPromise = reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      draft: trackedDraft,
      warnings: ["Revisar"],
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ value: { summary: "Revisión completada" }, runId: null, trackingStatus: "unavailable", attempted: true });
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
    expect(aiMocks.createAttempt).not.toHaveBeenCalled();
  });

  it("does not block the response when attempt persistence times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://unresponsive");
    aiMocks.createRun.mockResolvedValue({ id: "run-attempt-timeout" });
    aiMocks.createAttempt.mockImplementation(() => new Promise(() => {}));
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      providerMetadata: null,
      finishReason: "stop",
      text: "",
    });

    const resultPromise = reviewPolicyPdfWithAi({ user: { id: "agent-1", role: "AGENT", organizationId: "org-test" }, draft: trackedDraft, warnings: [] });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ value: { summary: "Revisión completada" }, trackingStatus: "unavailable", attempted: true });
    expect(aiMocks.generateText).toHaveBeenCalledTimes(1);
    expect(aiMocks.finalizeAttempt).not.toHaveBeenCalled();
  });

  it("marks audit unavailable when attempt finalization times out", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://unresponsive");
    aiMocks.createRun.mockResolvedValue({ id: "run-finalize-timeout" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt-finalize-timeout" });
    aiMocks.finalizeAttempt.mockImplementation(() => new Promise(() => {}));
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      providerMetadata: null,
      finishReason: "stop",
      text: "",
    });

    const resultPromise = reviewPolicyPdfWithAi({ user: { id: "agent-1", role: "AGENT", organizationId: "org-test" }, draft: trackedDraft, warnings: [] });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    const runId = aiMocks.createRun.mock.calls[0]?.[0].id;
    expect(result).toMatchObject({ value: { summary: "Revisión completada" }, runId, trackingStatus: "unavailable", attempted: true });
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "SUCCEEDED" }));
  });

  it("creates an independent audit run for each PDF review invocation", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("DATABASE_URL", "postgres://disposable");
    aiMocks.createRun.mockResolvedValue({ id: "run" });
    aiMocks.createAttempt.mockResolvedValue({ id: "attempt" });
    aiMocks.generateText.mockResolvedValue({
      output: { summary: "Revisión completada", warnings: [], suggestions: [], corrections: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      providerMetadata: null,
      finishReason: "stop",
      text: "",
    });

    const input = { user: { id: "agent-1", role: "AGENT" as const, organizationId: "org-test" }, draft: trackedDraft, warnings: ["Revisar"] };
    const first = await reviewPolicyPdfWithAi(input);
    const second = await reviewPolicyPdfWithAi(input);
    const runIds = aiMocks.createRun.mock.calls.map((call) => call[0].id);

    expect(first.attempted).toBe(true);
    expect(second.attempted).toBe(true);
    expect(aiMocks.createRun).toHaveBeenCalledTimes(2);
    expect(new Set(runIds).size).toBe(2);
  });

  it("tries conversation models in Luna, DeepSeek 0731, Nano order", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "openai/gpt-5.6-luna");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "deepseek/deepseek-v4-flash-0731,openai/gpt-5.4-nano");
    aiMocks.generateText
      .mockRejectedValueOnce(new Error("Luna unavailable"))
      .mockRejectedValueOnce(new Error("DeepSeek unavailable"))
      .mockResolvedValueOnce({ text: "Respuesta de Nano", usage: null, totalUsage: null, providerMetadata: null, finishReason: "stop" });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT", organizationId: "org-test" },
      message: "Dame una respuesta amplia sobre la cartera y sus riesgos.",
      localReply: { reply: "Resumen local", sections: [], quickPrompts: [] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resolvedModel).toBe("openai/gpt-5.4-nano");
      expect(result.value.trace.map((entry) => entry.requestedModel)).toEqual([
        "openai/gpt-5.6-luna",
        "deepseek/deepseek-v4-flash-0731",
        "openai/gpt-5.4-nano",
      ]);
    }
    expect(aiMocks.generateText.mock.calls.map((call) => call[0].model)).toEqual([
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-flash-0731",
      "openai/gpt-5.4-nano",
    ]);
  });
});
