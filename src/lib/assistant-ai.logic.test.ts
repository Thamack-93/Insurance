import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildAssistantAiReply } from "@/lib/assistant-ai";
import type { AssistantUser } from "@/lib/assistant-types";

describe("assistant ai fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when the AI gateway is not configured", async () => {
    vi.stubEnv("VERCEL_AI_GATEWAY_URL", "");
    vi.stubEnv("VERCEL_AI_GATEWAY_API_KEY", "");

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
});
