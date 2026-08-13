import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getAssistantAiMonthlySpend = vi.hoisted(() => vi.fn());
vi.mock("@/lib/assistant-ai-runs", () => ({ getAssistantAiMonthlySpend }));

import {
  getNoraAgentMode,
  getNoraAiBudgetStatus,
  getNoraAiMonthlySoftLimitUsd,
  isNoraAgentEnabledForUser,
} from "@/lib/assistant-agent-config";

describe("Nora agent rollout configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the rollout mode is missing or invalid", () => {
    vi.stubEnv("NORA_AGENT_MODE", "invalid");

    expect(getNoraAgentMode()).toBe("off");
    expect(isNoraAgentEnabledForUser({ id: "admin-1", role: "ADMIN" })).toBe(false);
  });

  it("supports an admin-only pilot before enabling every agent", () => {
    vi.stubEnv("NORA_AGENT_MODE", "admin");

    expect(isNoraAgentEnabledForUser({ id: "admin-1", role: "ADMIN" })).toBe(true);
    expect(isNoraAgentEnabledForUser({ id: "agent-1", role: "AGENT" })).toBe(false);
  });

  it("uses four dollars as the safe default for invalid limits", () => {
    vi.stubEnv("NORA_AI_MONTHLY_SOFT_LIMIT_USD", "not-a-number");
    expect(getNoraAiMonthlySoftLimitUsd()).toBe(4);

    vi.stubEnv("NORA_AI_MONTHLY_SOFT_LIMIT_USD", "7.5");
    expect(getNoraAiMonthlySoftLimitUsd()).toBe(7.5);
  });

  it("warns at 80% and blocks Luna at the monthly soft limit", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured");
    vi.stubEnv("NORA_AI_MONTHLY_SOFT_LIMIT_USD", "4");
    getAssistantAiMonthlySpend.mockResolvedValueOnce({ costUsd: 3.2, runCount: 10 });
    const warningStatus = await getNoraAiBudgetStatus();
    expect(warningStatus).toMatchObject({
      allowed: true,
      warning: expect.stringContaining("80%"),
      spentUsd: 3.2,
      limitUsd: 4,
    });

    getAssistantAiMonthlySpend.mockResolvedValueOnce({ costUsd: 4, runCount: 12 });
    await expect(getNoraAiBudgetStatus()).resolves.toMatchObject({
      allowed: false,
      warning: expect.stringContaining("alcanzó el límite"),
      spentUsd: 4,
      limitUsd: 4,
    });
  });
});
