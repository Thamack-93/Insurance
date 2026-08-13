import { daysUntil, today } from "../src/lib/dates.ts";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "../src/lib/renewal-decisions.ts";
import { getLatestReceiptStatus, LATEST_RENEWAL_RECEIPT_INCLUDE } from "../src/lib/renewal-receipt.ts";
import { shouldIncludeInRenewals } from "../src/lib/renewals.logic.ts";
import {
  closeDb,
  createDb,
  formatDateShort,
  hasFlag,
  parseCliArgs,
  printTable,
} from "./_shared.ts";

type RenewalAudit = {
  asOf: string;
  totalPolicies: number;
  expiredPolicies: number;
  activeOverduePolicies: number;
  activeOverdueWithSuccessor: number;
  activeOverdueWithDecision: number;
  unresolvedOverdueRenewals: number;
  unresolvedOverdueWithCancelledLatestReceipt: number;
  statusCounts: Array<{ status: string; count: number }>;
  unresolvedSample: Array<{
    policyNumber: string;
    client: string;
    endDate: string;
    daysOverdue: number;
  }>;
};

async function collectAudit(): Promise<RenewalAudit> {
  const db = createDb();
  const now = today();

  try {
    const overdueActiveWhere = { status: "ACTIVE", endDate: { lt: now } } as const;
    const unresolvedOverdueWhere = {
      ...ACTIVE_RENEWAL_POLICY_WHERE,
      endDate: { lt: now },
    };

    const [totalPolicies, expiredPolicies, activeOverduePolicies, activeOverdueWithSuccessor, activeOverdueWithDecision, statusRows, unresolvedRows] = await Promise.all([
      db.policy.count(),
      db.policy.count({ where: { status: "EXPIRED" } }),
      db.policy.count({ where: overdueActiveWhere }),
      db.policy.count({ where: { ...overdueActiveWhere, renewals: { some: {} } } }),
      db.policy.count({
        where: {
          ...overdueActiveWhere,
          sourceRenewalSuggestions: { some: { status: { in: ["ACCEPTED", "DECLINED"] } } },
        },
      }),
      db.policy.groupBy({ by: ["status"], _count: { _all: true }, orderBy: { status: "asc" } }),
      db.policy.findMany({
        where: unresolvedOverdueWhere,
        include: {
          client: { select: { fullName: true } },
          ...LATEST_RENEWAL_RECEIPT_INCLUDE,
        },
        orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
        take: 20,
      }),
    ]);

    const eligibleRows = unresolvedRows.filter((row) =>
      shouldIncludeInRenewals(row.status, row.endDate, getLatestReceiptStatus(row.receipts)),
    );

    return {
      asOf: formatDateShort(now),
      totalPolicies,
      expiredPolicies,
      activeOverduePolicies,
      activeOverdueWithSuccessor,
      activeOverdueWithDecision,
      unresolvedOverdueRenewals: eligibleRows.length,
      unresolvedOverdueWithCancelledLatestReceipt: unresolvedRows.length - eligibleRows.length,
      statusCounts: statusRows.map((row) => ({ status: row.status, count: row._count._all })),
      unresolvedSample: eligibleRows.map((row) => ({
        policyNumber: row.policyNumber,
        client: row.client.fullName,
        endDate: formatDateShort(row.endDate),
        daysOverdue: Math.abs(daysUntil(row.endDate)),
      })),
    };
  } finally {
    await closeDb(db);
  }
}

async function main() {
  const audit = await collectAudit();

  if (hasFlag(parseCliArgs(), "json")) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  console.log(`Auditoría de renovaciones (solo lectura) · corte ${audit.asOf}`);
  console.log(`Pólizas totales: ${audit.totalPolicies}`);
  console.log(`Vigencias terminadas (EXPIRED): ${audit.expiredPolicies}`);
  console.log(`Activas con vencimiento pasado: ${audit.activeOverduePolicies}`);
  console.log(`Activas vencidas con póliza sucesora: ${audit.activeOverdueWithSuccessor}`);
  console.log(`Activas vencidas con decisión aceptada o declinada: ${audit.activeOverdueWithDecision}`);
  console.log(`Renovaciones vencidas sin resolver: ${audit.unresolvedOverdueRenewals}`);
  console.log(`Excluidas por último recibo cancelado: ${audit.unresolvedOverdueWithCancelledLatestReceipt}`);

  printTable(
    "Distribución por estado",
    audit.statusCounts.map((row) => ({ Estado: row.status, Pólizas: row.count })),
  );
  printTable("Muestra de renovaciones vencidas sin resolver (máximo 20)", audit.unresolvedSample.map((row) => ({
    Póliza: row.policyNumber,
    Cliente: row.client,
    Vencimiento: row.endDate,
    "Días vencida": row.daysOverdue,
  })));
}

main().catch((error) => {
  console.error("No se pudo completar la auditoría de renovaciones.");
  console.error(error);
  process.exit(1);
});
