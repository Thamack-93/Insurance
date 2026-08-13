import "server-only";

import { getAssistantAiMonthlySpend } from "@/lib/assistant-ai-runs";
import type { AssistantUser } from "@/lib/assistant-types";

export type NoraAgentMode = "off" | "admin" | "all";

export function getNoraAgentMode(): NoraAgentMode {
  const configured = process.env.NORA_AGENT_MODE?.trim().toLowerCase();
  return configured === "admin" || configured === "all" ? configured : "off";
}

export function isNoraAgentEnabledForUser(user: AssistantUser) {
  const mode = getNoraAgentMode();
  return mode === "all" || (mode === "admin" && user.role === "ADMIN");
}

export function getNoraAiMonthlySoftLimitUsd() {
  const configured = Number(process.env.NORA_AI_MONTHLY_SOFT_LIMIT_USD ?? "4");
  return Number.isFinite(configured) && configured > 0 ? configured : 4;
}

export async function getNoraAiBudgetStatus() {
  const limitUsd = getNoraAiMonthlySoftLimitUsd();
  if (!process.env.DATABASE_URL?.trim()) return { allowed: true, warning: null, spentUsd: 0, limitUsd };
  const monthly = await getAssistantAiMonthlySpend();
  const ratio = limitUsd > 0 ? monthly.costUsd / limitUsd : 1;
  if (ratio >= 1) {
    return {
      allowed: false,
      warning: `Nora alcanzó el límite mensual interno de IA (${limitUsd.toFixed(2)} USD).`,
      spentUsd: monthly.costUsd,
      limitUsd,
    };
  }
  return {
    allowed: true,
    warning: ratio >= 0.8 ? `Nora ha consumido ${Math.round(ratio * 100)}% de su límite mensual interno de IA.` : null,
    spentUsd: monthly.costUsd,
    limitUsd,
  };
}
