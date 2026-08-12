import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getGenerationInfo: vi.fn(),
  createRun: vi.fn(),
  createAttempt: vi.fn(),
  finalizeAttempt: vi.fn(),
  finalizeRun: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  const gateway = Object.assign((model: string) => model, { getGenerationInfo: aiMocks.getGenerationInfo });
  return { ...actual, generateText: aiMocks.generateText, gateway };
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

    const user: AssistantUser = { id: "agent-1", role: "AGENT" };
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

  it("uses a configurable model with the Luna primary default", () => {
    vi.stubEnv("AI_GATEWAY_MODEL", "minimax/minimax-m3");
    expect(getAssistantAiModel()).toBe("minimax/minimax-m3");

    vi.stubEnv("AI_GATEWAY_MODEL", "invalid-model");
    expect(getAssistantAiModel()).toBe("openai/gpt-5.6-luna");
  });

  it("prefers API key when both supported credentials exist", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");

    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");
  });

  it("defaults to the ordered Luna fallback chain", () => {
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "");
    expect(getAssistantGatewayFallbackModels()).toEqual(["minimax/minimax-m3", "openai/gpt-5.4-nano"]);

    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "openai/gpt-5.4-mini, deepseek/deepseek-v3");
    expect(getAssistantGatewayFallbackModels()).toEqual(["openai/gpt-5.4-mini", "deepseek/deepseek-v3"]);
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
      model: "openai/gpt-5.6-luna",
      fallbackModels: ["minimax/minimax-m3", "openai/gpt-5.4-nano"],
    });
  });

  it("reports a PDF review as unavailable when credentials are absent", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL", "");

    const result = await reviewPolicyPdfWithAi({
      user: { id: "agent-1", role: "AGENT" },
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
      user: { id: "agent-1", role: "AGENT" },
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
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "SUCCEEDED", responsePreview: "Policy PDF review completed.", finalModel: "openai/gpt-5.6-luna" }));
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
      user: { id: "agent-1", role: "AGENT" },
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
    expect(aiMocks.finalizeRun).toHaveBeenCalledWith(runId, expect.objectContaining({ status: "SUCCEEDED", finalModel: "openai/gpt-5.6-luna" }));
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
      user: { id: "agent-1", role: "AGENT" },
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
      user: { id: "agent-1", role: "AGENT" },
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
      user: { id: "agent-1", role: "AGENT" },
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

    const resultPromise = reviewPolicyPdfWithAi({ user: { id: "agent-1", role: "AGENT" }, draft: trackedDraft, warnings: [] });
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

    const resultPromise = reviewPolicyPdfWithAi({ user: { id: "agent-1", role: "AGENT" }, draft: trackedDraft, warnings: [] });
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

    const input = { user: { id: "agent-1", role: "AGENT" as const }, draft: trackedDraft, warnings: ["Revisar"] };
    const first = await reviewPolicyPdfWithAi(input);
    const second = await reviewPolicyPdfWithAi(input);
    const runIds = aiMocks.createRun.mock.calls.map((call) => call[0].id);

    expect(first.attempted).toBe(true);
    expect(second.attempted).toBe(true);
    expect(aiMocks.createRun).toHaveBeenCalledTimes(2);
    expect(new Set(runIds).size).toBe(2);
  });

  it("tries conversation models in Luna, MiniMax, Nano order", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("AI_GATEWAY_MODEL", "openai/gpt-5.6-luna");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "minimax/minimax-m3,openai/gpt-5.4-nano");
    aiMocks.generateText
      .mockRejectedValueOnce(new Error("Luna unavailable"))
      .mockRejectedValueOnce(new Error("MiniMax unavailable"))
      .mockResolvedValueOnce({ text: "Respuesta de Nano", usage: null, totalUsage: null, providerMetadata: null, finishReason: "stop" });

    const result = await buildAssistantAiReply({
      user: { id: "agent-1", role: "AGENT" },
      message: "Dame una respuesta amplia sobre la cartera y sus riesgos.",
      localReply: { reply: "Resumen local", sections: [], quickPrompts: [] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resolvedModel).toBe("openai/gpt-5.4-nano");
      expect(result.value.trace.map((entry) => entry.requestedModel)).toEqual([
        "openai/gpt-5.6-luna",
        "minimax/minimax-m3",
        "openai/gpt-5.4-nano",
      ]);
    }
    expect(aiMocks.generateText.mock.calls.map((call) => call[0].model)).toEqual([
      "openai/gpt-5.6-luna",
      "minimax/minimax-m3",
      "openai/gpt-5.4-nano",
    ]);
  });
});
