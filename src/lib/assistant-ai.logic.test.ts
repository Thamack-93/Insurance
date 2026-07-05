import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  buildAssistantAiReply,
  getAssistantAiModel,
  getAssistantGatewayAuthMode,
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
    expect(getAssistantAiModel()).toBe("openai/gpt-5.4");
  });

  it("prefers OIDC when both supported credentials exist", () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key");
    expect(getAssistantGatewayAuthMode()).toBe("oidc");

    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(getAssistantGatewayAuthMode()).toBe("api-key");
  });
});
