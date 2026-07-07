import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildAssistantAiReply,
  getAssistantAiConnectionStatus,
  getAssistantAiModel,
  getAssistantGatewayAuthMode,
  getAssistantGatewayFallbackModels,
} from "@/lib/assistant-ai";
import type { AssistantUser } from "@/lib/assistant-types";

describe("assistant ai fallback", () => {
  afterEach(() => {
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

    expect(reply).toBeNull();
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

  it("defaults to gpt-4o-mini as the fallback gateway model", () => {
    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "");
    expect(getAssistantGatewayFallbackModels()).toEqual(["openai/gpt-4o-mini"]);

    vi.stubEnv("AI_GATEWAY_FALLBACK_MODELS", "openai/gpt-4o-mini, deepseek/deepseek-v3");
    expect(getAssistantGatewayFallbackModels()).toEqual(["openai/gpt-4o-mini", "deepseek/deepseek-v3"]);
  });

  it("treats a Vercel deployment as gateway-capable even without a local token", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL", "1");

    expect(getAssistantAiConnectionStatus()).toEqual({
      available: true,
      authMode: "deployment",
      model: "minimax/minimax-m3",
      fallbackModels: ["openai/gpt-4o-mini"],
    });
  });
});
