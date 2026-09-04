import "server-only";

import { getAssistantAiMonthlySpend } from "@/lib/assistant-ai-runs";
import type { AssistantUser } from "@/lib/assistant-types";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";

export type NoraAgentMode = "off" | "admin" | "all";

export function getNoraAgentMode(): NoraAgentMode {
  const configured = process.env.NORA_AGENT_MODE?.trim().toLowerCase();
  if (configured === "admin" || configured === "all" || configured === "off") return configured;
  return "off";
}

export function isNoraAgentEnabledForUser(user: AssistantUser) {
  const mode = getNoraAgentMode();
  return mode === "all" || (mode === "admin" && user.role === "ADMIN");
}

export function getNoraAiMonthlySoftLimitUsd() {
  const configured = Number(process.env.NORA_AI_MONTHLY_SOFT_LIMIT_USD ?? "4");
  return Number.isFinite(configured) && configured > 0 ? configured : 4;
}

export async function getNoraAiBudgetStatus(organizationId?: string) {
  if (!organizationId) {
    if (process.env.NODE_ENV === "production") return { allowed: false, warning: "Nora requiere un contexto de organización válido.", spentUsd: 0, limitUsd: 0 };
    const limitUsd = getNoraAiMonthlySoftLimitUsd();
    return { allowed: true, warning: null, spentUsd: 0, limitUsd };
  }
  const capability = await resolveOrganizationCapability(organizationId, "NORA").catch(() => {
    if (process.env.NODE_ENV === "production") return { enabled: false, limitValue: 0 };
    return { enabled: true, limitValue: null };
  });
  const limitUsd = capability.limitValue ?? getNoraAiMonthlySoftLimitUsd();
  if (!capability.enabled) return { allowed: false, warning: "Nora no está habilitada para esta organización.", spentUsd: 0, limitUsd };
  if (!process.env.DATABASE_URL?.trim()) return { allowed: true, warning: null, spentUsd: 0, limitUsd };
  const monthly = await getAssistantAiMonthlySpend(organizationId);
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
