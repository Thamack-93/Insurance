import "server-only";

import type { AssistantPrompt, AssistantReply, AssistantSection, AssistantSnapshot, AssistantUser } from "@/lib/assistant-types";
import { formatDate } from "@/lib/dates";
import { getTodayData } from "@/lib/dashboard-queries";
import { daysUntil } from "@/lib/dates";
import { getPolicyDataQualityScores, getReceiptReviewIssues, getRenewalReviewSuggestions } from "@/lib/data-quality";
import { formatCurrency } from "@/lib/money";
import { detectRisks } from "@/lib/risk-engine";
import { getLatestMaintenanceRun } from "@/lib/vigency-maintenance";
import { globalSearch, type GlobalSearchResult } from "@/lib/search";
import { getAssistantAiConnectionStatus } from "@/lib/assistant-ai";
import { searchPolicyCaptureEntities } from "@/lib/policy-capture-search";

function normalizeMessage(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function isConsistencyAuditQuery(normalized: string) {
  return (
    (normalized.includes("coincid") ||
      normalized.includes("inconsist") ||
      normalized.includes("descuadr") ||
      normalized.includes("solap") ||
      normalized.includes("duplic") ||
      normalized.includes("concil")) &&
    (normalized.includes("fech") || normalized.includes("vigenc") || normalized.includes("recib") || normalized.includes("renovac"))
  );
}

function makeSection(title: string, summary: string, items: AssistantSection["items"]): AssistantSection {
  return { title, summary, items };
}

function buildQuickPrompts(): AssistantPrompt[] {
  return [
    { label: "Resumen de hoy", prompt: "hoy" },
    { label: "Renovaciones 30 días", prompt: "renovaciones 30" },
    { label: "Recibos vencidos", prompt: "recibos vencidos" },
    { label: "Buscar cliente", prompt: "buscar cliente" },
  ];
}

const INFORMATIONAL_QUICK_PROMPTS: AssistantPrompt[] = [];

function inlineLink(label: string, href: string) {
  return `[${label}](${href})`;
}

function formatCount(total: number, cap?: number) {
  return cap && total >= cap ? `${cap} o más` : String(total);
}

function formatMoreCount(total: number, shown: number, cap?: number) {
  if (cap && total >= cap) return `\nMuestro ${shown} de al menos ${cap}.`;
  const remaining = total - shown;
  return remaining > 0 ? `\nY ${remaining} más.` : "";
}

function formatReceiptDueState(dueDate: Date, state: "overdue" | "today" | "upcoming") {
  const days = daysUntil(dueDate);
  if (state === "overdue") {
    return `Venció el ${formatDate(dueDate)}${days < 0 ? ` (hace ${Math.abs(days)} días)` : ""}`;
  }
  if (state === "today") return "Vence hoy";
  return `Vence el ${formatDate(dueDate)}${days > 0 ? ` (en ${days} días)` : ""}`;
}

function formatRenewalText(policy: {
  id: string;
  policyNumber: string;
  client: { fullName: string };
  insurer?: { name: string };
  premiumAmount?: unknown;
  currency?: string;
  endDate: Date;
}) {
  const days = daysUntil(policy.endDate);
  const relative = days === 0 ? "hoy" : days > 0 ? `en ${days} días` : `hace ${Math.abs(days)} días`;
  const premium = policy.premiumAmount != null
    ? ` · Prima: ${formatCurrency(policy.premiumAmount, policy.currency ?? "MXN")}`
    : "";
  const insurer = policy.insurer?.name ? ` · ${policy.insurer.name}` : "";
  return `- ${inlineLink(`Póliza ${policy.policyNumber}`, `/policies/${policy.id}`)} — ${policy.client.fullName}${insurer}${premium} · Vence el ${formatDate(policy.endDate)} (${relative}).`;
}

function formatReceiptText(receipt: {
  id: string;
  receiptNumber: string;
  client: { fullName: string };
  policy: { id?: string; policyNumber: string };
  insurer?: { name: string };
  dueDate: Date;
  amount: unknown;
  currency?: string;
}, state: "overdue" | "today" | "upcoming") {
  const insurer = receipt.insurer?.name ? ` · ${receipt.insurer.name}` : "";
  const policy = receipt.policy.id
    ? inlineLink(`Póliza ${receipt.policy.policyNumber}`, `/policies/${receipt.policy.id}`)
    : `Póliza ${receipt.policy.policyNumber}`;
  return `- ${receipt.client.fullName} — ${policy} · Recibo ${receipt.receiptNumber}${insurer} · ${formatCurrency(receipt.amount, receipt.currency ?? "MXN")} · ${formatReceiptDueState(receipt.dueDate, state)} [Ver recibo](/receipts/${receipt.id}).`;
}

function formatPlainGroup(title: string, total: number, lines: string[], limit: number, cap?: number) {
  if (total === 0) return `${title}: ninguno.`;
  const shown = Math.min(total, limit);
  return `${title} (${formatCount(total, cap)}):\n${lines.slice(0, limit).join("\n")}${formatMoreCount(total, shown, cap)}`;
}

function formatSectionItemsAsText(items: AssistantSection["items"], total: number, title: string, limit: number) {
  const lines = items.map((item) => `- ${inlineLink(item.title, item.href)} — ${item.subtitle}${item.meta ? ` · ${item.meta}` : ""}.`);
  return formatPlainGroup(title, total, lines, limit);
}

function informationalReply(reply: string, todayMetrics?: AssistantReply["todayMetrics"]): AssistantReply {
  return {
    reply,
    sections: [],
    quickPrompts: INFORMATIONAL_QUICK_PROMPTS,
    ...(todayMetrics ? { todayMetrics } : {}),
  };
}

function extractPolicyNumber(normalized: string) {
  const match = normalized.match(/\b\d{5,}\b/);
  return match?.[0] ?? null;
}

function extractRenewalWindowDays(normalized: string) {
  const explicit = normalized.match(/\b(\d{1,3})\s*(?:dias?|days?)\b/);
  if (explicit) return Number(explicit[1]);

  const afterRenewals = normalized.match(/\brenov(?:acion(?:es)?)?(?:\s+(?:a|en|de|por))?\s*(\d{1,3})\b/);
  if (afterRenewals) return Number(afterRenewals[1]);

  return null;
}

function getRenewalsInWindow(days: number, todayData: Awaited<ReturnType<typeof getTodayData>>) {
  return todayData.urgentRenewals
    .filter((policy) => {
      const distance = daysUntil(policy.endDate);
      return distance >= 0 && distance <= days;
    })
    .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate) || a.id.localeCompare(b.id));
}

async function buildRenewalsReply(days: number): Promise<AssistantReply> {
  const todayData = await getTodayData();
  const renewals = getRenewalsInWindow(days, todayData);
  const dueSoonCount = renewals.length;
  const overdueCount = todayData.urgentRenewals.filter((policy) => daysUntil(policy.endDate) < 0).length;
  const summary =
    days === 30
      ? `Tienes ${dueSoonCount} renovación${dueSoonCount === 1 ? "" : "es"} dentro de los próximos 30 días${overdueCount > 0 ? ` y ${overdueCount} vencida${overdueCount === 1 ? "" : "s"}` : ""}.`
      : `Tienes ${dueSoonCount} renovación${dueSoonCount === 1 ? "" : "es"} dentro de los próximos ${days} días${overdueCount > 0 ? ` y ${overdueCount} vencida${overdueCount === 1 ? "" : "s"}` : ""}.`;
  const detail = renewals.length > 0
    ? `\n\n${renewals.slice(0, 6).map(formatRenewalText).join("\n")}${formatMoreCount(renewals.length, 6)}`
    : "\n\nNo hay pólizas que venzan dentro de este periodo.";
  return informationalReply(`${summary}${detail}`);
}

function normalizeMaintenanceSummary(summaryJson: string | null) {
  if (!summaryJson) return null;
  try {
    return JSON.parse(summaryJson) as {
      paymentFrequencyReviewSample?: Array<{
        policyId: string;
        policyNumber: string;
        currentFrequency: string;
        receiptCount: number;
        reason: string;
      }>;
      receiptIssuesOpened?: number;
      receiptIssuesResolved?: number;
      familiesLinked?: number;
      overlappingFamilies?: number;
      paymentFrequenciesNormalized?: number;
    };
  } catch {
    return null;
  }
}

function buildConsistencySectionSubtitle(policy: {
  cliente: string;
  aseguradora: string;
  endDate: Date;
  issues: Array<{ etiqueta: string }>;
}) {
  const issueSummary = policy.issues.slice(0, 2).map((issue) => issue.etiqueta).join(" · ");
  return [policy.cliente, policy.aseguradora, `Vence ${formatDate(policy.endDate)}`, issueSummary || null]
    .filter(Boolean)
    .join(" · ");
}

async function buildConsistencyAuditReply(user: AssistantUser): Promise<AssistantReply> {
  const portfolioOwnerId = user.role === "ADMIN" ? undefined : user.id;
  const [riskFindings, policyScores, receiptIssues, renewalSuggestions, latestRun] = await Promise.all([
    detectRisks(portfolioOwnerId, user.organizationId),
    getPolicyDataQualityScores(),
    getReceiptReviewIssues(),
    getRenewalReviewSuggestions(),
    getLatestMaintenanceRun("POLICY_VIGENCY_AUDIT"),
  ]);

  const policyScoresByNumber = new Map(policyScores.map((policy) => [policy.poliza, policy]));
  const relevantRiskTypes = new Set(["INCONSISTENT_DATES", "OVERLAPPING_POLICY_TERM", "POLICY_WITHOUT_RECEIPTS"]);
  const consistencyRisks = riskFindings.filter((finding) => relevantRiskTypes.has(finding.alertType));
  const policyRiskItems = consistencyRisks
    .slice(0, 6)
    .map((finding) => {
      const policyNumber = finding.description.split(" · ")[0]?.trim() || finding.description;
      const policyScore = policyScoresByNumber.get(policyNumber);
      const subtitle = policyScore
        ? buildConsistencySectionSubtitle(policyScore)
        : finding.suggestedAction;

      return {
        title: policyNumber,
        subtitle: `${finding.title}${subtitle ? ` · ${subtitle}` : ""}`,
        href: policyScore ? `/policies/${policyScore.polizaId}` : "/risks",
        meta: finding.severity.toLowerCase(),
      };
    });

  const receiptItems = receiptIssues
    .slice(0, 6)
    .map((issue) => ({
      title: issue.receiptNumber,
      subtitle: [
        issue.policyNumber,
        issue.clientName,
        issue.insurerName,
        `Vence ${formatDate(issue.dueDate)}`,
        issue.paidDate ? `Pagado ${formatDate(issue.paidDate)}` : "Pendiente de pago",
        issue.gapDays != null ? `${issue.gapDays} días de diferencia` : null,
        issue.dispositionLabel,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/receipts/${issue.receiptId}`,
      meta: issue.reason,
    }));

  const renewalItems = renewalSuggestions
    .filter((suggestion) => suggestion.status !== "RESOLVED" && suggestion.status !== "ARCHIVED" && suggestion.status !== "DELETED")
    .slice(0, 6)
    .map((suggestion) => ({
      title: suggestion.sourcePolicyNumber,
      subtitle: [
        suggestion.clientName,
        suggestion.insurerName,
        `Vigencia ${formatDate(suggestion.sourceStartDate)} → ${formatDate(suggestion.sourceEndDate)}`,
        suggestion.targetPolicyNumber ? `Vinculada a ${suggestion.targetPolicyNumber}` : "Sin vínculo aún",
        suggestion.dispositionLabel,
      ]
        .filter(Boolean)
        .join(" · "),
      href: suggestion.targetPolicyId ? `/policies/${suggestion.targetPolicyId}` : `/policies/${suggestion.sourcePolicyId}`,
      meta: suggestion.status,
    }));

  const maintenanceSummary = normalizeMaintenanceSummary(latestRun?.summaryJson ?? null);
  const maintenanceSample = maintenanceSummary?.paymentFrequencyReviewSample?.slice(0, 6).map((sample) => ({
    title: sample.policyNumber,
    subtitle: `Frecuencia ${sample.currentFrequency} · ${sample.receiptCount} recibos · ${sample.reason}`,
    href: `/policies/${sample.policyId}`,
    meta: "vigencia",
  })) ?? [];

  const riskCount = policyRiskItems.length;
  const receiptCount = receiptItems.length;
  const renewalCount = renewalItems.length;
  const maintenanceNote = maintenanceSummary
    ? `Última auditoría de vigencia: ${maintenanceSummary.paymentFrequencyReviewSample?.length ?? 0} casos revisados en muestra, ${maintenanceSummary.receiptIssuesOpened ?? 0} incidencias abiertas y ${maintenanceSummary.receiptIssuesResolved ?? 0} resueltas.`
    : "No encontré una auditoría reciente de vigencias, pero sí puedo revisar el estado actual de la cartera.";

  const policyText = consistencyRisks.length > 0
    ? formatSectionItemsAsText(policyRiskItems, consistencyRisks.length, "Pólizas con fechas o vigencias a revisar", 6)
    : `Pólizas con fechas o vigencias a revisar: ninguno. ${inlineLink("Ver riesgos", "/risks")}.`;
  const receiptText = receiptIssues.length > 0
    ? formatSectionItemsAsText(receiptItems, receiptIssues.length, "Recibos con conciliación pendiente", 6)
    : `Recibos con conciliación pendiente: ninguno. ${inlineLink("Abrir control de datos", "/data-quality")}.`;
  const openRenewalCount = renewalSuggestions.filter((suggestion) => !["RESOLVED", "ARCHIVED", "DELETED"].includes(suggestion.status)).length;
  const renewalText = openRenewalCount > 0
    ? formatSectionItemsAsText(renewalItems, openRenewalCount, "Renovaciones relacionadas", 6)
    : `Renovaciones relacionadas: ninguno. ${inlineLink("Ver renovaciones", "/operations?view=renewals")}.`;
  const maintenanceText = maintenanceSample.length > 0
    ? formatSectionItemsAsText(maintenanceSample, maintenanceSample.length, "Mantenimiento de vigencia", 6)
    : `Mantenimiento de vigencia:\n${maintenanceNote} ${inlineLink("Abrir auditoría", "/data-quality")}.`;

  return informationalReply([
    riskCount > 0 || receiptCount > 0 || renewalCount > 0
      ? `Encontré ${riskCount} póliza${riskCount === 1 ? "" : "s"} con fechas o vigencias a revisar, ${receiptCount} recibo${receiptCount === 1 ? "" : "s"} con conciliación pendiente y ${renewalCount} renovación${renewalCount === 1 ? "" : "es"} relacionadas.`
      : "No veo inconsistencias activas en fechas, vigencias o recibos dentro del alcance de tu usuario.",
    policyText,
    receiptText,
    renewalText,
    maintenanceText,
  ].join("\n\n"));
}

function policyCaptureItemToSectionItem(item: Awaited<ReturnType<typeof searchPolicyCaptureEntities>>[number]) {
  return {
    title: item.label,
    subtitle: item.description,
    href: `/policies/${item.id}`,
    meta: item.meta?.status ?? "policy",
  };
}

async function buildTargetedConsistencyAuditReply(user: AssistantUser, policyNumber: string): Promise<AssistantReply> {
  const portfolioOwnerId = user.role === "ADMIN" ? undefined : user.id;
  const [policyMatches, relatedResults] = await Promise.all([
    searchPolicyCaptureEntities("policy", policyNumber, { portfolioOwnerId }),
    searchUserPortfolio(user, policyNumber),
  ]);

  const primaryPolicy = policyMatches[0] ?? null;
  const policyItems = policyMatches.slice(0, 5).map(policyCaptureItemToSectionItem);
  const relatedItems = relatedResults
    .filter((result) => result.type !== "policy" || result.title !== policyNumber)
    .slice(0, 5)
    .map((result) => ({
      title: result.title,
      subtitle: [result.subtitle, result.details?.[0]].filter(Boolean).join(" · "),
      href: result.href,
      meta: result.type,
    }));

  const reply = primaryPolicy
    ? `Encontré la póliza ${policyNumber} y voy a centrar la revisión en ese folio.`
    : `No encontré una coincidencia exacta para la póliza ${policyNumber}, pero sí puedo revisar las coincidencias relacionadas dentro de tu cartera.`;

  const focusItems = policyItems.length > 0
    ? policyItems
    : [{ title: policyNumber, subtitle: "No encontré una coincidencia exacta todavía.", href: "/policies", meta: "buscar" }];
  const related = relatedItems.length > 0
    ? relatedItems
    : [{ title: "Sin coincidencias relacionadas", subtitle: "No encontré vínculos directos en esta revisión.", href: "/policies", meta: "ok" }];
  const visibleItems = primaryPolicy
    ? [{ title: primaryPolicy.label, subtitle: primaryPolicy.description, href: `/policies/${primaryPolicy.id}`, meta: primaryPolicy.meta?.status ?? "policy" }]
    : [{ title: "Abrir búsqueda de póliza", subtitle: "Buscar por número, cliente o serie.", href: "/policies", meta: "buscar" }];

  return informationalReply([
    reply,
    formatSectionItemsAsText(focusItems, policyMatches.length || focusItems.length, "Póliza foco", 5),
    formatSectionItemsAsText(related, relatedResults.length, "Coincidencias relacionadas", 5),
    formatSectionItemsAsText(visibleItems, visibleItems.length, "Datos visibles", 1),
  ].join("\n\n"));
}

async function buildPolicyChangeReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);
  const policyNumber = extractPolicyNumber(normalized);
  const searchQuery = policyNumber ?? message;
  const results = await searchUserPortfolio(user, searchQuery);
  const policyResults = results.filter((result) => result.href.startsWith("/policies/"));
  const target = policyResults[0] ?? null;
  const targetLabel = target?.title ?? policyNumber ?? "la póliza";

  return {
    reply: target
      ? `Encontré ${targetLabel}. Dime la nueva fecha de vencimiento y te preparo la edición.`
      : policyNumber
        ? `No encontré la póliza ${policyNumber} dentro de tu cartera. Si quieres, dime la nueva fecha y revisamos si el número está incompleto o si la póliza está fuera de tu alcance.`
        : "Puedo cambiar la fecha de vencimiento de una póliza. Dime el número exacto y la nueva fecha, y te preparo la edición.",
    sections: [
      makeSection(
        "Cambiar vencimiento",
        target ? "La póliza objetivo está identificada, falta confirmar la nueva fecha." : "Necesito identificar la póliza exacta para continuar.",
        target
          ? [
              {
                title: target.title,
                subtitle: target.subtitle ?? "Abrir póliza para editar vencimiento",
                href: target.href,
                meta: "editar",
              },
            ]
          : [
              {
                title: "Abrir búsqueda de póliza",
                subtitle: "Busca por número, cliente, RFC o aseguradora.",
                href: "/policies",
                meta: "buscar",
              },
            ],
      ),
    ],
    quickPrompts: [
      { label: "Cambiar vencimiento", prompt: "Cambiar fecha de vencimiento de la póliza" },
      { label: "Buscar póliza", prompt: "Buscar póliza" },
      { label: "Ver renovaciones", prompt: "Renovaciones próximas" },
    ],
  };
}

function buildHomeSections(user: AssistantUser): AssistantSection[] {
  const accessLabel = user.role === "ADMIN" ? "Vista administrativa" : "Vista operativa";

  return [
    makeSection(
      "Puntos de partida",
      "Atajos para consultar lo más útil sin salir del contexto.",
      [
        { title: "Renovaciones", subtitle: "Pólizas próximas a vencer o sin seguimiento", href: "/operations?view=renewals", meta: "seguimiento" },
        { title: "Riesgos", subtitle: "Hallazgos críticos y advertencias", href: "/risks", meta: "auditoría" },
        { title: "Calidad de datos", subtitle: "Resumen de completitud y hallazgos", href: "/data-quality", meta: "control" },
      ],
    ),
    makeSection(
      "Sugerencias rápidas",
      `Usa estos accesos como punto de arranque en la ${accessLabel.toLowerCase()}.`,
      [
        { title: "Buscar póliza", subtitle: "Abrir una póliza por número o cliente", href: "/policies", meta: "consulta" },
        { title: "Crear renovación", subtitle: "Ir al flujo de alta con vínculo", href: "/policies/new", meta: "alta" },
        { title: "Revisar pendientes", subtitle: "Ver pendientes y seguimientos abiertos", href: "/operations?view=pending", meta: "operación" },
      ],
    ),
  ];
}

function formatWorkItemText(item: {
  id: string;
  title: string;
  folio?: string | null;
  client?: { fullName: string } | null;
  policy?: { id?: string; policyNumber: string; endDate?: Date | null } | null;
  insurer?: { name: string } | null;
  dueDate?: Date | null;
  priority?: string | null;
}) {
  const client = item.client?.fullName ?? "Cliente no vinculado";
  const policy = item.policy?.id
    ? inlineLink(`Póliza ${item.policy.policyNumber}`, `/policies/${item.policy.id}`)
    : `Póliza ${item.policy?.policyNumber ?? "no vinculada"}`;
  const insurer = item.insurer?.name ? ` · ${item.insurer.name}` : "";
  const due = item.dueDate ? ` · Vence ${formatDate(item.dueDate)}` : "";
  const priority = item.priority ? ` · Prioridad ${item.priority.toLowerCase()}` : "";
  return `- ${item.title} — ${client} · ${policy}${insurer}${due}${priority} [Ver pendiente](/tasks/${item.id}).`;
}

function formatCommissionText(commission: {
  id: string;
  client: { fullName: string };
  policy?: { id?: string; policyNumber: string } | null;
  insurer?: { name: string } | null;
  expectedDate?: Date | null;
  expectedAmount?: unknown;
  actualAmount?: unknown;
  currency?: string;
}) {
  const policy = commission.policy?.id
    ? inlineLink(`Póliza ${commission.policy.policyNumber}`, `/policies/${commission.policy.id}`)
    : `Póliza ${commission.policy?.policyNumber ?? "no vinculada"}`;
  const amount = commission.actualAmount ?? commission.expectedAmount;
  const amountText = amount != null ? ` · ${formatCurrency(amount, commission.currency ?? "MXN")}` : "";
  const date = commission.expectedDate ? ` · Fecha esperada ${formatDate(commission.expectedDate)}` : "";
  const insurer = commission.insurer?.name ? ` · ${commission.insurer.name}` : "";
  return `- ${commission.client.fullName} · ${policy}${insurer}${amountText}${date} [Ver comisiones](/commissions).`;
}

async function buildTodayReply(): Promise<AssistantReply> {
  const todayData = await getTodayData();
  const dueTodayCount = todayData.paymentsDueToday.length;
  const overdueCount = todayData.overduePayments.length;
  const due7Count = todayData.paymentsDue7.length;
  const renewalsCount = todayData.urgentRenewals.length;
  const overdueWorkItemsCount = todayData.overdueWorkItems.length;
  const commissionsCount = todayData.commissionsToReview.length;
  const reply =
    `Hoy tienes ${formatCount(overdueCount, 8)} recibo${overdueCount === 1 ? "" : "s"} vencido${overdueCount === 1 ? "" : "s"}, ` +
    `${formatCount(dueTodayCount)} que vencen hoy, ${formatCount(due7Count, 8)} en los próximos 7 días, ` +
    `${formatCount(renewalsCount)} renovación${renewalsCount === 1 ? "" : "es"} en 30 días, ` +
    `${formatCount(overdueWorkItemsCount, 8)} pendiente${overdueWorkItemsCount === 1 ? "" : "s"} atrasado${overdueWorkItemsCount === 1 ? "" : "s"} y ` +
    `${formatCount(commissionsCount, 8)} comisión${commissionsCount === 1 ? "" : "es"} por revisar.`;

  const todayText = [
    reply,
    formatPlainGroup("Recibos vencidos", overdueCount, todayData.overduePayments.map((receipt) => formatReceiptText(receipt, "overdue")), 3, 8),
    formatPlainGroup("Recibos que vencen hoy", dueTodayCount, todayData.paymentsDueToday.map((receipt) => formatReceiptText(receipt, "today")), 3),
    formatPlainGroup("Renovaciones próximas", renewalsCount, todayData.urgentRenewals.map(formatRenewalText), 3),
    formatPlainGroup("Pendientes atrasados", overdueWorkItemsCount, todayData.overdueWorkItems.map(formatWorkItemText), 3, 8),
    formatPlainGroup("Comisiones por revisar", commissionsCount, todayData.commissionsToReview.map(formatCommissionText), 3, 8),
  ].join("\n\n");

  return informationalReply(todayText, {
    dueTodayCount,
    overdueCount,
    due7Count,
    renewals30Count: renewalsCount,
    openWorkItemsCount: overdueWorkItemsCount,
    commissionsCount,
  });
}

async function buildReceiptsReply(kind: "overdue" | "today" | "upcoming"): Promise<AssistantReply> {
  const todayData = await getTodayData();
  const receipts = kind === "overdue"
    ? todayData.overduePayments
    : kind === "today"
      ? todayData.paymentsDueToday
      : todayData.paymentsDue7;
  const label = kind === "overdue" ? "vencidos" : kind === "today" ? "que vencen hoy" : "de los próximos 7 días";
  const count = receipts.length;
  const state = kind === "overdue" ? "overdue" : kind === "today" ? "today" : "upcoming";
  const cap = kind === "today" ? undefined : 8;
  const summary = count > 0
    ? `Encontré ${formatCount(count, cap)} recibo${count === 1 ? "" : "s"} ${label}.`
    : `No encontré recibos ${label} dentro de tu cartera accesible.`;
  const detail = count > 0
    ? `\n\n${receipts.slice(0, 8).map((receipt) => formatReceiptText(receipt, state)).join("\n")}${formatMoreCount(count, Math.min(count, 8), cap)}`
    : "";
  return informationalReply(`${summary}${detail}`);
}

function buildSearchTerms(message: string) {
  const terms = new Set<string>();
  for (const match of message.matchAll(/[A-Z0-9][A-Z0-9/-]{3,}/gi)) {
    terms.add(match[0]);
  }

  for (const match of message.matchAll(/(?:cliente|p[oó]liza|recibo|siniestro)\s+([^,.;?]+)/gi)) {
    const candidate = match[1]?.replace(/\b(?:es|la|el|de|del|una?|renovaci[oó]n)\b/gi, " ").replace(/\s+/g, " ").trim();
    if (candidate && candidate.length >= 3) terms.add(candidate);
  }

  if (terms.size === 0) {
    const fallback = message
      .replace(/\b(?:busca|buscar|encuentra|encontrar|mu[eé]strame|cliente|p[oó]liza|recibo|por|favor)\b/gi, " ")
      .replace(/[^\p{L}\p{N}'/-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (fallback.length >= 3) terms.add(fallback);
  }

  return [...terms].slice(0, 3);
}

function formatSearchResultText(result: GlobalSearchResult) {
  const context = [result.subtitle, result.parentLabel, result.match ? `Coincide en ${result.match.fieldLabel}` : null]
    .filter(Boolean)
    .join(" · ");
  return `- ${inlineLink(result.title, result.href)}${context ? ` — ${context}` : ""}.`;
}

function formatRiskText(finding: {
  alertType: string;
  severity: string;
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  suggestedAction: string;
}) {
  const href = finding.entityType === "Policy"
    ? `/policies/${finding.entityId}`
    : finding.entityType === "Receipt"
      ? `/receipts/${finding.entityId}`
      : finding.entityType === "WorkItem"
        ? `/tasks/${finding.entityId}`
        : finding.entityType === "Client"
          ? `/clients/${finding.entityId}`
          : "/risks";
  return `- ${inlineLink(finding.title, href)} — ${finding.description} · Prioridad ${finding.severity.toLowerCase()} · Siguiente paso: ${finding.suggestedAction}.`;
}

export async function searchUserPortfolio(user: AssistantUser, message: string) {
  const terms = buildSearchTerms(message);
  const resultGroups = await Promise.all(terms.map((term) => globalSearch(term, user.role === "ADMIN" ? undefined : user.id, user.organizationId)));
  const unique = new Map<string, GlobalSearchResult>();
  for (const result of resultGroups.flat()) unique.set(`${result.type}:${result.id}`, result);
  return [...unique.values()].slice(0, 8);
}

async function buildPromptReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  const normalized = normalizeMessage(message);
  const renewalWindowDays = extractRenewalWindowDays(normalized);
  const explicitPolicyNumber = extractPolicyNumber(normalized);

  if (
    normalized.includes("hoy") ||
    normalized.includes("today") ||
    normalized.includes("diario") ||
    normalized.includes("agenda") ||
    (normalized.includes("resumen") && normalized.includes("dia"))
  ) {
    return buildTodayReply();
  }

  if (isConsistencyAuditQuery(normalized)) {
    if (explicitPolicyNumber) {
      return buildTargetedConsistencyAuditReply(user, explicitPolicyNumber);
    }
    return buildConsistencyAuditReply(user);
  }

  if (normalized.includes("recibo") || normalized.includes("cobro")) {
    if (normalized.includes("vencid") || normalized.includes("atrasad")) return buildReceiptsReply("overdue");
    if (normalized.includes("hoy")) return buildReceiptsReply("today");
    if (normalized.includes("proxim") || normalized.includes("7 dia") || normalized.includes("abiert")) return buildReceiptsReply("upcoming");
    return informationalReply(
      `Puedo mostrarte ${inlineLink("recibos vencidos", "/receipts?tab=cobrar&status=overdue")}, ${inlineLink("recibos de hoy", "/receipts?tab=cobrar&status=today")} o ${inlineLink("todos los recibos", "/receipts")}.`,
    );
  }

  if (normalized.includes("renov")) {
    if (renewalWindowDays) {
      return buildRenewalsReply(renewalWindowDays);
    }

    return informationalReply(
      `Puedo ayudarte a revisar renovaciones próximas, vencidas o sin seguimiento. ${inlineLink("Ver renovaciones", "/operations?view=renewals")} o ${inlineLink("revisar calidad de datos", "/data-quality")} para encontrar vínculos faltantes.`,
    );
  }

  if (
    normalized.includes("poliz") &&
    (normalized.includes("cambi") || normalized.includes("modific") || normalized.includes("editar") || normalized.includes("vencim") || normalized.includes("vigencia"))
  ) {
    return buildPolicyChangeReply(user, message);
  }

  if (normalized.includes("riesg")) {
    const findings = await detectRisks(user.role === "ADMIN" ? undefined : user.id, user.organizationId);
    const visible = findings.slice(0, 6);
    const detail = visible.length > 0
      ? `\n\n${visible.map(formatRiskText).join("\n")}${formatMoreCount(findings.length, visible.length, 25)}`
      : "\n\nNo encontré riesgos activos dentro de tu cartera accesible.";
    return informationalReply(
      `Encontré ${findings.length} riesgo${findings.length === 1 ? "" : "s"} activo${findings.length === 1 ? "" : "s"}. ${inlineLink("Abrir tablero de riesgos", "/risks")} o ${inlineLink("revisar calidad de datos", "/data-quality")}.${detail}`,
    );
  }

  if (normalized.includes("buscar") || normalized.includes("cliente") || normalized.includes("poliza") || normalized.includes("póliza")) {
    const results = await searchUserPortfolio(user, message);
    if (results.length === 0) {
      return informationalReply(
        `No encontré coincidencias dentro de tu cartera. Prueba con el número de póliza, nombre completo, RFC, teléfono, serie o número de recibo. ${inlineLink("Abrir búsqueda", "/policies")}.`,
      );
    }
    const visible = results.slice(0, 8);
    return informationalReply(
      `Encontré ${formatCount(results.length, 8)} resultado${results.length === 1 ? "" : "s"} dentro de tu cartera:\n\n${visible.map(formatSearchResultText).join("\n")}${formatMoreCount(results.length, visible.length, 8)}`,
    );
  }

  return informationalReply(
    `Te puedo ayudar a revisar ${inlineLink("renovaciones", "/operations?view=renewals")}, ${inlineLink("riesgos", "/risks")}, ${inlineLink("calidad de datos", "/data-quality")} o a encontrar una póliza. Dime qué estás buscando y te llevo a la sección más útil.`,
  );
}

export async function getAssistantHomeSnapshot(user: AssistantUser): Promise<AssistantSnapshot> {
  return {
    scopeLabel: user.role === "ADMIN" ? "Administración" : "Operación",
    welcome:
      user.role === "ADMIN"
        ? "Revisa renovaciones, riesgos y calidad de datos con vista administrativa."
        : "Consulta renovaciones, riesgos y calidad de datos desde una vista operativa.",
    ai: getAssistantAiConnectionStatus(),
    summaryCards: [
      { label: "Renovaciones", value: "Abrir", description: "Ver próximos vencimientos y seguimientos.", href: "/operations?view=renewals" },
      { label: "Riesgos", value: "Abrir", description: "Revisar alertas y hallazgos críticos.", href: "/risks" },
      { label: "Calidad", value: "Abrir", description: "Inspeccionar datos y vínculos faltantes.", href: "/data-quality" },
    ],
    sections: buildHomeSections(user),
    quickPrompts: buildQuickPrompts(),
  };
}

export async function buildAssistantReply(user: AssistantUser, message: string): Promise<AssistantReply> {
  return buildPromptReply(user, message);
}
