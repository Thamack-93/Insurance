import { getDb } from "@/lib/db";
import { differenceInCalendarDays } from "date-fns";
import { today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { globalSearch } from "@/lib/search";

export type DataQualityIssue = {
  code: string;
  etiqueta: string;
  descripcion: string;
  penalizacion: number;
};

export type ClientQualityScore = {
  clienteId: string;
  cliente: string;
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

export type LedgerReviewIssue = {
  issueId: string;
  batchId: string;
  batchStatus: string;
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
  const issues = await db.receiptReconciliationIssue.findMany({
    where: {
      status: "OPEN",
    },
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
    .map<ReceiptReviewIssue>((issue) => {
      const receipt = issue.receipt!;
      const latestPayment = receipt.payments[0] ?? null;
      const paidDate = receipt.paidDate ?? latestPayment?.paidDate ?? null;
      const paidAmount = receipt.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);

      return {
        issueId: issue.id,
        reason: issue.reason,
        status: issue.status,
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

  return suggestions.map<RenewalReviewSuggestion>((suggestion) => ({
    suggestionId: suggestion.id,
    status: suggestion.status,
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
  const issues = await db.ledgerImportIssue.findMany({
    where: {
      status: "OPEN",
    },
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

  return issues.map<LedgerReviewIssue>((issue) => ({
    issueId: issue.id,
    batchId: issue.batchId,
    batchStatus: issue.batch.status,
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
  const clients = await db.client.findMany({
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

  return clients
    .map<ClientQualityScore>((client) => {
      const issues: DataQualityIssue[] = [];
      let score = 100;

      if (!client.email) {
        issues.push({
          code: "CLIENT_EMAIL_MISSING",
          etiqueta: "Email faltante",
          descripcion: "El cliente no tiene correo electrónico registrado.",
          penalizacion: 20,
        });
        score -= 20;
      }

      if (!client.phone && !client.secondaryPhone) {
        issues.push({
          code: "CLIENT_PHONE_MISSING",
          etiqueta: "Teléfono faltante",
          descripcion: "El cliente no tiene teléfono principal ni secundario.",
          penalizacion: 20,
        });
        score -= 20;
      }

      if (!client.address) {
        issues.push({
          code: "CLIENT_ADDRESS_MISSING",
          etiqueta: "Dirección faltante",
          descripcion: "Falta la dirección postal del cliente.",
          penalizacion: 15,
        });
        score -= 15;
      }

      if (!client.rfc) {
        issues.push({
          code: "CLIENT_RFC_MISSING",
          etiqueta: "RFC faltante",
          descripcion: "No se capturó RFC para el cliente.",
          penalizacion: 10,
        });
        score -= 10;
      }

      if (!client.preferredContactMethod) {
        issues.push({
          code: "CLIENT_CONTACT_METHOD_MISSING",
          etiqueta: "Método de contacto faltante",
          descripcion: "No se indicó un medio de contacto preferido.",
          penalizacion: 10,
        });
        score -= 10;
      }

      const totalPolizas = client.policies.length;
      const polizasActivas = client.policies.filter((policy) => policy.status === "ACTIVE").length;
      const ingresosEstimados = client.policies.reduce(
        (sum, policy) => sum + toNumber(policy.premiumAmount),
        0,
      );

      if (totalPolizas === 0) {
        issues.push({
          code: "CLIENT_WITHOUT_POLICY",
          etiqueta: "Sin pólizas",
          descripcion: "El cliente no tiene pólizas registradas.",
          penalizacion: 15,
        });
        score -= 15;
      }

      const completitud = Math.max(
        0,
        Math.round(
          ((Number(Boolean(client.email)) +
            Number(Boolean(client.phone || client.secondaryPhone)) +
            Number(Boolean(client.address)) +
            Number(Boolean(client.rfc)) +
            Number(Boolean(client.preferredContactMethod))) /
            5) *
            100,
        ),
      );

      return {
        clienteId: client.id,
        cliente: client.fullName,
        score: clampScore(score),
        nivel: qualityLevel(score),
        completitud,
        totalPolizas,
        polizasActivas,
        ingresosEstimados,
        issues,
      };
    })
    .sort((a, b) => a.score - b.score || a.cliente.localeCompare(b.cliente));
}

export async function getPolicyDataQualityScores() {
  const db = getDb();
  const policies = await db.policy.findMany({
    select: {
      id: true,
      policyNumber: true,
      status: true,
      paymentFrequency: true,
      insuredObject: true,
      premiumAmount: true,
      clientId: true,
      _count: {
        select: {
          receipts: true,
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
      const issues: DataQualityIssue[] = [];
      let score = 100;

      const hasInsuredParty = policy.insuredParties.length > 0;
      const hasInsuredAsset = policy.insuredAssets.length > 0;

      if (!policy.insuredObject && !hasInsuredParty && !hasInsuredAsset) {
        issues.push({
          code: "POLICY_OBJECT_MISSING",
          etiqueta: "Objeto asegurado faltante",
          descripcion: "La póliza no describe el objeto asegurado.",
          penalizacion: 15,
        });
        score -= 15;
      }

      if (policy.status === "PENDING") {
        issues.push({
          code: "POLICY_PENDING",
          etiqueta: "Póliza pendiente",
          descripcion: "La póliza sigue en estado pendiente.",
          penalizacion: 10,
        });
        score -= 10;
      }

      if (!toNumber(policy.premiumAmount)) {
        issues.push({
          code: "POLICY_PREMIUM_MISSING",
          etiqueta: "Prima faltante",
          descripcion: "La póliza no tiene prima capturada.",
          penalizacion: 15,
        });
        score -= 15;
      }

      if (policy.paymentFrequency === "SINGLE" && policy._count.receipts > 1) {
        issues.push({
          code: "POLICY_PAYMENT_FREQUENCY_REVIEW",
          etiqueta: "Frecuencia de pago para revisar",
          descripcion: "La póliza está marcada como única, pero tiene múltiples recibos y conviene validar si debe normalizarse.",
          penalizacion: 8,
        });
        score -= 8;
      }

      const completitud = Math.max(
        0,
        Math.round(
          ((Number(Boolean(policy.insuredObject || hasInsuredParty || hasInsuredAsset)) +
            Number(Boolean(toNumber(policy.premiumAmount)))) /
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
        score: clampScore(score),
        nivel: qualityLevel(score),
        completitud,
        issues,
      };
    })
    .sort((a, b) => a.score - b.score || a.poliza.localeCompare(b.poliza));
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function qualityLevel(score: number): ClientQualityScore["nivel"] {
  if (score >= 90) return "Excelente";
  if (score >= 75) return "Bueno";
  if (score >= 50) return "Atención";
  return "Crítico";
}
