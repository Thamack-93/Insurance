import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { enrichAssistantAiUsageCost, estimateAssistantAiCostUsd, normalizeAssistantAiUsage } from "@/lib/assistant-ai-runs";

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

  it("estimates discounted Luna and Nano prices", () => {
    const usage = normalizeAssistantAiUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });

    expect(estimateAssistantAiCostUsd("openai/gpt-5.6-luna", usage)).toBe(1.4);
    expect(estimateAssistantAiCostUsd("openai/gpt-5.4-nano", usage)).toBe(1.45);
  });

  it("estimates the economical Gemini and DeepSeek fallback prices", () => {
    const usage = normalizeAssistantAiUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });

    expect(estimateAssistantAiCostUsd("google/gemini-3-flash", usage)).toBe(3.5);
    expect(estimateAssistantAiCostUsd("deepseek/deepseek-v3.1", usage)).toBe(1.2);
  });

  it("estimates Qwen 3.7 and DeepSeek V4 Flash catalog prices", () => {
    const usage = normalizeAssistantAiUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });

    expect(estimateAssistantAiCostUsd("alibaba/qwen3.7-flash", usage)).toBe(0.16);
    expect(estimateAssistantAiCostUsd("deepseek/deepseek-v4-flash", usage)).toBe(0.27);
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

  it("preserves text and reasoning token details from the AI SDK", () => {
    const usage = normalizeAssistantAiUsage({
      inputTokens: 100,
      outputTokenDetails: { textTokens: 240, reasoningTokens: 760 },
    });

    expect(usage).toMatchObject({
      outputTokens: 1_000,
      textTokens: 240,
      reasoningTokens: 760,
      totalTokens: 1_100,
    });
  });

  it("separates Luna normal input, cache reads, cache writes and output", () => {
    const usage = normalizeAssistantAiUsage({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      inputTokenDetails: {
        noCacheTokens: 700_000,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 100_000,
      },
    });
    const enriched = enrichAssistantAiUsageCost("openai/gpt-5.6-luna", usage);

    expect(enriched).toMatchObject({
      nonCachedInputTokens: 700_000,
      cacheReadTokens: 200_000,
      cacheWriteTokens: 100_000,
      nonCachedInputCostUsd: 0.14,
      cacheReadCostUsd: 0.004,
      cacheWriteCostUsd: 0.025,
      outputCostUsd: 1.2,
      estimatedCostUsd: 1.369,
    });
  });
});
