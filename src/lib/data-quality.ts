import { getDb } from "@/lib/db";
import { differenceInCalendarDays } from "date-fns";
import { today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { globalSearch } from "@/lib/search";
import { matchesSuppressionCriteria } from "@/lib/data-quality-rules";
import { getOverdueRenewals, getUpcomingRenewals } from "@/lib/renewals";

export type DataQualityIssue = {
  code: string;
  etiqueta: string;
  descripcion: string;
  penalizacion: number;
  entityType?: "Client" | "Policy";
  entityId?: string;
};

export type ClientQualityScore = {
  clienteId: string;
  cliente: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  address: string | null;
  rfc: string | null;
  preferredContactMethod: string | null;
  score: number;
  nivel: "Excelente" | "Bueno" | "Atención" | "Crítico";
  completitud: number;
  totalPolizas: number;
  polizasActivas: number;
  ingresosEstimados: number;
  issues: DataQualityIssue[];
};

export type PolicyQualityScore = {
  polizaId: string;
  poliza: string;
  clienteId: string;
  cliente: string;
  aseguradora: string;
  status: string;
  premiumAmount: number;
  paymentFrequency: string;
  insuredObject: string | null;
  notes: string | null;
  score: number;
  nivel: "Excelente" | "Bueno" | "Atención" | "Crítico";
  completitud: number;
  issues: DataQualityIssue[];
};

export type OperationalDataHealthSummary = {
  clientsWithoutPortfolioOwner: number;
  activeDemoUsers: number;
  demoUsers: Array<{ id: string; email: string; name: string; active: boolean }>;
  brokerDemoPresent: boolean;
  overdueOpenReceipts: number;
  overdueOpenReceiptsOwned: number;
  globalSearchOk: boolean;
  globalSearchResultCount: number;
  insuredOnlyClientsWithoutPolicies: number;
};

export type ReceiptReviewIssue = {
  issueId: string;
  reason: string;
  status: string;
  dispositionLabel: string;
  suppressedByRuleId: string | null;
  duplicateOfId: string | null;
  receiptId: string;
  receiptNumber: string;
  policyId: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  amount: number;
  paidAmount: number;
  currency: string;
  dueDate: Date;
  paidDate: Date | null;
  paymentCount: number;
  gapDays: number | null;
  resolutionNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

export type RenewalReviewSuggestion = {
  suggestionId: string;
  status: string;
  dispositionLabel: string;
  suppressedByRuleId: string | null;
  duplicateOfId: string | null;
  reason: string | null;
  resolutionNote: string | null;
  reviewedAt: Date | null;
  sourcePolicyId: string;
  sourcePolicyNumber: string;
  sourcePolicyStatus: string;
  clientName: string;
  insurerName: string;
  sourceStartDate: Date;
  sourceEndDate: Date;
  targetPolicyId: string | null;
  targetPolicyNumber: string | null;
  targetPolicyStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RenewalFollowUpClient = {
  clienteId: string;
  cliente: string;
  overduePolicies: number;
  followUpPolicies: number;
  nextRenewalDate: Date | null;
  items: Array<{
    policyId: string;
    policyNumber: string;
    daysUntilRenewal: number;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    status: "OVERDUE" | "FOLLOW_UP";
  }>;
};

export type LedgerReviewIssue = {
  issueId: string;
  batchId: string;
  batchStatus: string;
  dispositionLabel: string;
  suppressedByRuleId: string | null;
  duplicateOfId: string | null;
  batchCsvName: string;
  batchPaidName: string;
  rowId: string | null;
  rowNumber: number | null;
  sourceType: string | null;
  sourceKey: string | null;
  issueType: string;
  severity: string;
  status: string;
  message: string;
  resolutionNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

function describeDisposition(status: string, suppressedByRuleId: string | null, duplicateOfId: string | null) {
  if (duplicateOfId) return "Fusionada";
  if (suppressedByRuleId) return "Suprimida";
  if (status === "OPEN" || status === "PENDING") return "Abierta";
  if (status === "RESOLVED") return "Resuelta";
  if (status === "ACCEPTED") return "Resuelta";
  if (status === "DECLINED") return "Declinada";
  if (status === "DISMISSED") return "Descartada";
  return status;
}

function buildRiskIssueMatch(input: {
  issueCode: string;
  entityType: "Client" | "Policy";
  entityId: string;
}) {
  return {
    issueCode: input.issueCode,
    entityType: input.entityType,
    entityId: input.entityId,
  };
}

async function loadRiskSuppressionRules() {
  const db = getDb();
  return db.dataQualitySuppressionRule.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      category: "RISKS",
    },
  });
}

function isRiskIssueSuppressed(
  rules: Array<{ issueCode: string; criteriaJson: string }>,
  issueCode: string,
  entityType: "Client" | "Policy",
  entityId: string,
) {
  return rules.some(
    (rule) =>
      rule.issueCode === issueCode &&
      matchesSuppressionCriteria(rule.criteriaJson, buildRiskIssueMatch({ issueCode, entityType, entityId })),
  );
}

export async function getOperationalDataHealthSummary(): Promise<OperationalDataHealthSummary> {
  const db = getDb();
  const now = today();
  const [
    clientsWithoutPortfolioOwner,
    demoUsers,
    overdueOpenReceipts,
    overdueOpenReceiptsOwned,
    insuredOnlyClientsWithoutPolicies,
  ] = await Promise.all([
    db.client.count({ where: { portfolioOwnerId: null } }),
    db.user.findMany({
      where: {
        OR: [
          { email: { contains: "demo" } },
          { name: { contains: "Demo" } },
          { email: "broker@policydesk.local" },
        ],
      },
      select: { id: true, email: true, name: true, active: true },
      orderBy: { email: "asc" },
    }),
    db.receipt.count({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    db.receipt.count({
      where: {
        dueDate: { lt: now },
        status: { notIn: ["PAID", "CANCELLED"] },
        client: { portfolioOwnerId: { not: null } },
      },
    }),
    db.client.count({
      where: {
        status: "ACTIVE",
        fullName: { contains: "ASEGURADO:" },
        policies: { none: {} },
      },
    }),
  ]);

  let globalSearchOk = false;
  let globalSearchResultCount = 0;
  try {
    const results = await globalSearch("199658");
    globalSearchResultCount = results.length;
    globalSearchOk = results.some((result) => result.title.includes("199658") || result.subtitle?.includes("199658"));
  } catch {
    globalSearchOk = false;
  }

  return {
    clientsWithoutPortfolioOwner,
    activeDemoUsers: demoUsers.filter((user) => user.active).length,
    demoUsers,
    brokerDemoPresent: demoUsers.some((user) => user.email === "broker@policydesk.local"),
    overdueOpenReceipts,
    overdueOpenReceiptsOwned,
    globalSearchOk,
    globalSearchResultCount,
    insuredOnlyClientsWithoutPolicies,
  };
}

export async function getReceiptReviewIssues(): Promise<ReceiptReviewIssue[]> {
  const db = getDb();
  const suppressionRules = await db.dataQualitySuppressionRule.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      category: "PAYMENTS",
    },
  });
  const issues = await db.receiptReconciliationIssue.findMany({
    where: {},
    include: {
      receipt: {
        include: {
          payments: {
            orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
          },
          client: true,
          policy: true,
          insurer: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });

  return issues
    .filter((issue) => issue.receipt && issue.receipt.policy && issue.receipt.client && issue.receipt.insurer)
    .filter((issue) => {
      const receipt = issue.receipt!;
      const fields = {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        policyId: receipt.policy.id,
        policyNumber: receipt.policy.policyNumber,
        reason: issue.reason,
      };

      return !suppressionRules.some((rule) => rule.issueCode === issue.reason && matchesSuppressionCriteria(rule.criteriaJson, fields));
    })
    .map<ReceiptReviewIssue>((issue) => {
      const receipt = issue.receipt!;
      const latestPayment = receipt.payments[0] ?? null;
      const paidDate = receipt.paidDate ?? latestPayment?.paidDate ?? null;
      const paidAmount = receipt.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);

      return {
        issueId: issue.id,
        reason: issue.reason,
        status: issue.status,
        dispositionLabel: describeDisposition(issue.status, issue.suppressedByRuleId, issue.duplicateOfId),
        suppressedByRuleId: issue.suppressedByRuleId,
        duplicateOfId: issue.duplicateOfId,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        policyId: receipt.policy.id,
        policyNumber: receipt.policy.policyNumber,
        clientName: receipt.client.fullName,
        insurerName: receipt.insurer.name,
        amount: toNumber(receipt.amount),
        paidAmount,
        currency: receipt.currency,
        dueDate: receipt.dueDate,
        paidDate,
        paymentCount: receipt.payments.length,
        gapDays: paidDate ? differenceInCalendarDays(paidDate, receipt.dueDate) : null,
        resolutionNote: issue.resolutionNote,
        reviewedAt: issue.reviewedAt,
        createdAt: issue.createdAt,
      };
    })
    .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime() || left.receiptNumber.localeCompare(right.receiptNumber));
}

export async function getRenewalReviewSuggestions(): Promise<RenewalReviewSuggestion[]> {
  const db = getDb();
  const suppressionRules = await db.dataQualitySuppressionRule.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      category: "RENOVATIONS",
    },
  });
  const suggestions = await db.policyRenewalSuggestion.findMany({
    include: {
      sourcePolicy: {
        include: {
          client: true,
          insurer: true,
        },
      },
      targetPolicy: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });

  return suggestions
    .filter((suggestion) => {
      const fields = {
        sourcePolicyId: suggestion.sourcePolicyId,
        sourcePolicyNumber: suggestion.sourcePolicy.policyNumber,
        targetPolicyId: suggestion.targetPolicyId ?? "",
        reason: suggestion.reason ?? "",
      };
      return !suppressionRules.some((rule) => rule.issueCode === (suggestion.reason ?? "RENEWAL_SUGGESTION") && matchesSuppressionCriteria(rule.criteriaJson, fields));
    })
    .map<RenewalReviewSuggestion>((suggestion) => ({
      suggestionId: suggestion.id,
      status: suggestion.status,
      dispositionLabel: describeDisposition(suggestion.status, suggestion.suppressedByRuleId, suggestion.duplicateOfId),
      suppressedByRuleId: suggestion.suppressedByRuleId,
      duplicateOfId: suggestion.duplicateOfId,
      reason: suggestion.reason,
      resolutionNote: suggestion.resolutionNote,
      reviewedAt: suggestion.reviewedAt,
      sourcePolicyId: suggestion.sourcePolicyId,
      sourcePolicyNumber: suggestion.sourcePolicy.policyNumber,
      sourcePolicyStatus: suggestion.sourcePolicy.status,
      clientName: suggestion.sourcePolicy.client.fullName,
      insurerName: suggestion.sourcePolicy.insurer.name,
      sourceStartDate: suggestion.sourcePolicy.startDate,
      sourceEndDate: suggestion.sourcePolicy.endDate,
      targetPolicyId: suggestion.targetPolicyId,
      targetPolicyNumber: suggestion.targetPolicy?.policyNumber ?? null,
      targetPolicyStatus: suggestion.targetPolicy?.status ?? null,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
    }));
}

export async function getLedgerReviewIssues(): Promise<LedgerReviewIssue[]> {
  const db = getDb();
  const suppressionRules = await db.dataQualitySuppressionRule.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      category: "LEDGER",
    },
  });
  const issues = await db.ledgerImportIssue.findMany({
    where: {},
    include: {
      batch: {
        select: {
          id: true,
          sourceCsvName: true,
          sourcePaidName: true,
          status: true,
        },
      },
      row: {
        select: {
          id: true,
          rowNumber: true,
          sourceType: true,
          sourceKey: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });

  return issues
    .filter((issue) => {
      const fields = {
        batchId: issue.batchId,
        rowId: issue.rowId ?? "",
        rowNumber: issue.row?.rowNumber ?? "",
        sourceType: issue.row?.sourceType ?? "",
        sourceKey: issue.row?.sourceKey ?? "",
        issueType: issue.issueType,
      };
      return !suppressionRules.some((rule) => rule.issueCode === issue.issueType && matchesSuppressionCriteria(rule.criteriaJson, fields));
    })
    .map<LedgerReviewIssue>((issue) => ({
      issueId: issue.id,
      batchId: issue.batchId,
      batchStatus: issue.batch.status,
      dispositionLabel: describeDisposition(issue.status, issue.suppressedByRuleId, issue.duplicateOfId),
      suppressedByRuleId: issue.suppressedByRuleId,
      duplicateOfId: issue.duplicateOfId,
      batchCsvName: issue.batch.sourceCsvName,
      batchPaidName: issue.batch.sourcePaidName,
      rowId: issue.rowId,
      rowNumber: issue.row?.rowNumber ?? null,
      sourceType: issue.row?.sourceType ?? null,
      sourceKey: issue.row?.sourceKey ?? null,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      message: issue.message,
      resolutionNote: issue.resolutionNote,
      reviewedAt: issue.reviewedAt,
      createdAt: issue.createdAt,
    }));
}

export async function getClientDataQualityScores() {
  const db = getDb();
  const suppressionRules = await loadRiskSuppressionRules();
  const clients = await db.client.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      secondaryPhone: true,
      address: true,
      rfc: true,
      preferredContactMethod: true,
      policies: {
        select: {
          status: true,
          premiumAmount: true,
        },
      },
    },
  });
  const completenessIssueCodes = new Set([
    "CLIENT_EMAIL_MISSING",
    "CLIENT_PHONE_MISSING",
    "CLIENT_ADDRESS_MISSING",
    "CLIENT_RFC_MISSING",
    "CLIENT_CONTACT_METHOD_MISSING",
  ]);

  return clients
    .map<ClientQualityScore>((client) => {
      const issueCandidates: DataQualityIssue[] = [];

      if (!client.email) {
        issueCandidates.push({
          code: "CLIENT_EMAIL_MISSING",
          etiqueta: "Email faltante",
          descripcion: "El cliente no tiene correo electrónico registrado.",
          penalizacion: 20,
        });
      }

      if (!client.phone && !client.secondaryPhone) {
        issueCandidates.push({
          code: "CLIENT_PHONE_MISSING",
          etiqueta: "Teléfono faltante",
          descripcion: "El cliente no tiene teléfono principal ni secundario.",
          penalizacion: 20,
        });
      }

      if (!client.address) {
        issueCandidates.push({
          code: "CLIENT_ADDRESS_MISSING",
          etiqueta: "Dirección faltante",
          descripcion: "Falta la dirección postal del cliente.",
          penalizacion: 15,
        });
      }

      if (!client.rfc) {
        issueCandidates.push({
          code: "CLIENT_RFC_MISSING",
          etiqueta: "RFC faltante",
          descripcion: "No se capturó RFC para el cliente.",
          penalizacion: 10,
        });
      }

      if (!client.preferredContactMethod) {
        issueCandidates.push({
          code: "CLIENT_CONTACT_METHOD_MISSING",
          etiqueta: "Método de contacto faltante",
          descripcion: "No se indicó un medio de contacto preferido.",
          penalizacion: 10,
        });
      }

      const totalPolizas = client.policies.length;
      const polizasActivas = client.policies.filter((policy) => policy.status === "ACTIVE").length;
      const ingresosEstimados = client.policies.reduce(
        (sum, policy) => sum + toNumber(policy.premiumAmount),
        0,
      );

      if (totalPolizas === 0) {
        issueCandidates.push({
          code: "CLIENT_WITHOUT_POLICY",
          etiqueta: "Sin pólizas",
          descripcion: "El cliente no tiene pólizas registradas.",
          penalizacion: 15,
        });
      }

      const openIssues = issueCandidates
        .filter((issue) => !isRiskIssueSuppressed(suppressionRules, issue.code, "Client", client.id))
        .map<DataQualityIssue>((issue) => ({
          ...issue,
          entityType: "Client",
          entityId: client.id,
        }));
      const score = clampScore(100 - openIssues.reduce((sum, issue) => sum + issue.penalizacion, 0));
      const completitud = Math.max(
        0,
        Math.round(((5 - openIssues.filter((issue) => completenessIssueCodes.has(issue.code)).length) / 5) * 100),
      );

      return {
        clienteId: client.id,
        cliente: client.fullName,
        email: client.email,
        phone: client.phone,
        secondaryPhone: client.secondaryPhone,
        address: client.address,
        rfc: client.rfc,
        preferredContactMethod: client.preferredContactMethod,
        score,
        nivel: clientQualityLevel(score),
        completitud,
        totalPolizas,
        polizasActivas,
        ingresosEstimados,
        issues: openIssues,
      };
    })
    .sort((a, b) => a.score - b.score || a.cliente.localeCompare(b.cliente));
}

export async function getPolicyDataQualityScores() {
  const db = getDb();
  const suppressionRules = await loadRiskSuppressionRules();
  const policies = await db.policy.findMany({
    select: {
      id: true,
      policyNumber: true,
      status: true,
      paymentFrequency: true,
      insuredObject: true,
      premiumAmount: true,
      notes: true,
      clientId: true,
      receipts: {
        select: {
          id: true,
          status: true,
          periodStartDate: true,
          periodEndDate: true,
          amount: true,
        },
      },
      insuredParties: {
        select: { id: true, isPrimary: true },
      },
      insuredAssets: {
        select: { id: true, isPrimary: true },
      },
      client: { select: { fullName: true } },
      insurer: { select: { name: true } },
    },
  });

  return policies
    .map<PolicyQualityScore>((policy) => {
      const issueCandidates: DataQualityIssue[] = [];

      const hasInsuredParty = policy.insuredParties.length > 0;
      const hasInsuredAsset = policy.insuredAssets.length > 0;

      if (!policy.insuredObject && !hasInsuredParty && !hasInsuredAsset) {
        issueCandidates.push({
          code: "POLICY_OBJECT_MISSING",
          etiqueta: "Objeto asegurado faltante",
          descripcion: "La póliza no describe el objeto asegurado.",
          penalizacion: 15,
        });
      }

      if (policy.status === "PENDING") {
        issueCandidates.push({
          code: "POLICY_PENDING",
          etiqueta: "Póliza pendiente",
          descripcion: "La póliza sigue en estado pendiente.",
          penalizacion: 10,
        });
      }

      if (!toNumber(policy.premiumAmount)) {
        issueCandidates.push({
          code: "POLICY_PREMIUM_MISSING",
          etiqueta: "Prima faltante",
          descripcion: "La póliza no tiene prima capturada.",
          penalizacion: 15,
        });
      }

      if (policy.paymentFrequency === "SINGLE" && policy.receipts.length > 1) {
        // Filter out cancelled receipts
        const activeReceipts = policy.receipts.filter((r) => r.status !== "CANCELLED");
        // Filter out prorrateo receipts (period < 30 days)
        const nonProratedReceipts = activeReceipts.filter((r) => {
          const days = differenceInCalendarDays(r.periodEndDate, r.periodStartDate);
          return days >= 30;
        });
        // Check if there are 2+ receipts with consecutive or non-overlapping periods
        if (nonProratedReceipts.length >= 2) {
          const sorted = [...nonProratedReceipts].sort(
            (a, b) => a.periodStartDate.getTime() - b.periodStartDate.getTime(),
          );
          const hasConsecutive = sorted.some((receipt, i) => {
            if (i === 0) return false;
            const prev = sorted[i - 1];
            // Check if periods are consecutive or non-overlapping with reasonable gap
            const gap = differenceInCalendarDays(receipt.periodStartDate, prev.periodEndDate);
            return gap >= 0 && gap <= 5; // Allow 5 days gap for grace period
          });
          if (hasConsecutive) {
            issueCandidates.push({
              code: "POLICY_PAYMENT_FREQUENCY_REVIEW",
              etiqueta: "Frecuencia de pago para revisar",
              descripcion: "La póliza está marcada como única, pero tiene múltiples recibos consecutivos y conviene validar si debe normalizarse.",
              penalizacion: 8,
            });
          }
        }
      }

      const openIssues = issueCandidates
        .filter((issue) => !isRiskIssueSuppressed(suppressionRules, issue.code, "Policy", policy.id))
        .map<DataQualityIssue>((issue) => ({
          ...issue,
          entityType: "Policy",
          entityId: policy.id,
        }));
      const score = clampScore(100 - openIssues.reduce((sum, issue) => sum + issue.penalizacion, 0));
      const completitud = Math.max(
        0,
        Math.round(
          ((2 -
            openIssues.filter((issue) => issue.code === "POLICY_OBJECT_MISSING" || issue.code === "POLICY_PREMIUM_MISSING")
              .length) /
            2) *
            100,
        ),
      );

      return {
        polizaId: policy.id,
        poliza: policy.policyNumber,
        clienteId: policy.clientId,
        cliente: policy.client.fullName,
        aseguradora: policy.insurer.name,
        status: policy.status,
        premiumAmount: toNumber(policy.premiumAmount),
        paymentFrequency: policy.paymentFrequency,
        insuredObject: policy.insuredObject,
        notes: policy.notes,
        score,
        nivel: policyQualityLevel(score),
        completitud,
        issues: openIssues,
      };
    })
    .sort((a, b) => a.score - b.score || a.poliza.localeCompare(b.poliza));
}

export async function getRenewalFollowUpClients(daysAhead = 30): Promise<RenewalFollowUpClient[]> {
  const [overdueRenewals, upcomingRenewals] = await Promise.all([
    getOverdueRenewals(),
    getUpcomingRenewals(daysAhead),
  ]);

  const grouped = new Map<string, RenewalFollowUpClient>();

  for (const renewal of [...overdueRenewals, ...upcomingRenewals]) {
    const status = renewal.daysUntilRenewal <= 0 ? "OVERDUE" : "FOLLOW_UP";
    const current = grouped.get(renewal.clientId) ?? {
      clienteId: renewal.clientId,
      cliente: renewal.clientName,
      overduePolicies: 0,
      followUpPolicies: 0,
      nextRenewalDate: renewal.endDate,
      items: [],
    };

    if (status === "OVERDUE") {
      current.overduePolicies += 1;
    } else {
      current.followUpPolicies += 1;
    }

    current.nextRenewalDate =
      current.nextRenewalDate === null || renewal.endDate < current.nextRenewalDate
        ? renewal.endDate
        : current.nextRenewalDate;

    current.items.push({
      policyId: renewal.policyId,
      policyNumber: renewal.policyNumber,
      daysUntilRenewal: renewal.daysUntilRenewal,
      priority: renewal.priority,
      status,
    });

    grouped.set(renewal.clientId, current);
  }

  return [...grouped.values()].sort(
    (left, right) =>
      right.overduePolicies - left.overduePolicies ||
      right.followUpPolicies - left.followUpPolicies ||
      (left.nextRenewalDate?.getTime() ?? Number.POSITIVE_INFINITY) -
        (right.nextRenewalDate?.getTime() ?? Number.POSITIVE_INFINITY) ||
      left.cliente.localeCompare(right.cliente),
  );
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function clientQualityLevel(score: number): ClientQualityScore["nivel"] {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bueno";
  return "Atención";
}

function policyQualityLevel(score: number): PolicyQualityScore["nivel"] {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bueno";
  if (score >= 50) return "Atención";
  return "Crítico";
}
