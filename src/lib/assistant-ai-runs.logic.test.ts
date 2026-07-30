import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { estimateAssistantAiCostUsd, normalizeAssistantAiUsage } from "@/lib/assistant-ai-runs";

describe("assistant AI cost accounting", () => {
  it("estimates current MiniMax M3 usage without rounding it to zero", () => {
    const usage = normalizeAssistantAiUsage({ inputTokens: 575, outputTokens: 169 });

    expect(usage).not.toBeNull();
    expect(estimateAssistantAiCostUsd("minimax/minimax-m3", usage)).toBe(0.0003753);
  });

  it("does not call missing token usage a zero-cost generation", () => {
    const usage = normalizeAssistantAiUsage({ totalTokens: 744 });

    expect(usage?.inputTokens).toBeNull();
    expect(estimateAssistantAiCostUsd("minimax/minimax-m3", usage)).toBeNull();
  });

  it("preserves Gateway billed cost and generation id", () => {
    const usage = normalizeAssistantAiUsage({
      inputTokens: 10,
      outputTokens: 5,
      billedCostUsd: 0.000012,
      costSource: "gateway",
      generationId: "gen_test",
    });

    expect(usage).toMatchObject({ billedCostUsd: 0.000012, costSource: "gateway", generationId: "gen_test" });
  });
});
