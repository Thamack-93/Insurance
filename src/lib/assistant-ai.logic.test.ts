import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateText: aiMocks.generateText,
  };
});
import {
  buildAssistantAiReply,
  getAssistantAiConnectionStatus,
  getAssistantAiModel,
  getAssistantGatewayAuthMode,
  getAssistantGatewayFallbackModels,
} from "@/lib/assistant-ai";
import type { AssistantUser } from "@/lib/assistant-types";
import { NoObjectGeneratedError } from "ai";

describe("assistant ai fallback", () => {
  afterEach(() => {
    aiMocks.generateText.mockReset();
    vi.unstubAllEnvs();
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

  it("uses a configurable model with a current gateway fallback", () => {
    vi.stubEnv("AI_GATEWAY_MODEL", "minimax/minimax-m3");
    expect(getAssistantAiModel()).toBe("minimax/minimax-m3");

    vi.stubEnv("AI_GATEWAY_MODEL", "invalid-model");
    expect(getAssistantAiModel()).toBe("minimax/minimax-m3");
  });

  it("prefers API key when both supported credentials exist", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");

    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");
  });

  it("defaults to gpt-5.4 mini as the fallback gateway model", () => {
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "");
    expect(getAssistantGatewayFallbackModels()).toEqual(["openai/gpt-5.4-mini"]);

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
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-5.4-mini"],
    });
  });

  it("retries with GPT-5.4 mini when MiniMax returns no_object_generated", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_GATEWAY_MODEL", "minimax/minimax-m3");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "openai/gpt-5.4-mini");

    aiMocks.generateText
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          response: {} as never,
          usage: {} as never,
          finishReason: "stop",
          text: "minimax raw text",
        }),
      )
      .mockResolvedValueOnce({
        output: {
          reply: "GPT-5.4 mini recuperó la respuesta.",
          quickPrompts: [],
          mutation: null,
        },
        text: JSON.stringify({
          reply: "GPT-5.4 mini recuperó la respuesta.",
          quickPrompts: [],
          mutation: null,
        }),
      });

    const user: AssistantUser = { id: "agent-1", role: "AGENT" };
    const reply = await buildAssistantAiReply({
      user,
      message: "Revisa la póliza 940454625",
      localReply: {
        reply: "Resumen local",
        sections: [],
        quickPrompts: [],
      },
    });

    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.value.reply).toBe("GPT-5.4 mini recuperó la respuesta.");
    }
    expect(aiMocks.generateText).toHaveBeenCalledTimes(2);
  });

  it("includes both attempts in the diagnostic when the retry also fails", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("AI_GATEWAY_MODEL", "minimax/minimax-m3");
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "openai/gpt-5.4-mini");

    aiMocks.generateText
      .mockResolvedValueOnce({ output: null, text: "primer intento sin objeto" })
      .mockResolvedValueOnce({ output: null, text: "segundo intento sin objeto" });

    const user: AssistantUser = { id: "agent-1", role: "AGENT" };
    const reply = await buildAssistantAiReply({
      user,
      message: "Revisa la póliza 940454625",
      localReply: {
        reply: "Resumen local",
        sections: [],
        quickPrompts: [],
      },
    });

    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.diagnostic.code).toBe("invalid_output");
      expect(reply.diagnostic.attempts).toHaveLength(2);
      expect(reply.diagnostic.details).toContain("Intento 1");
      expect(reply.diagnostic.details).toContain("GPT-5.4 mini");
    }
    expect(aiMocks.generateText).toHaveBeenCalledTimes(2);
  });
});
