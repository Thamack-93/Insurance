import { businessAddDays } from "../src/lib/business-dates.ts";
import { daysUntil, today } from "../src/lib/dates.ts";
import { LATEST_RENEWAL_RECEIPT_INCLUDE } from "../src/lib/renewal-receipt.ts";
import { shouldIncludeInRenewals } from "../src/lib/renewals.logic.ts";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "../src/lib/renewal-decisions.ts";

import {
  closeDb,
  compactText,
  createDb,
  formatCurrencyBreakdown,
  formatDateShort,
  formatMoney,
  getFlag,
  parseCliArgs,
  printTable,
  summarizeByCurrency,
} from "./_shared.ts";

async function main() {
  const args = parseCliArgs();
  const horizonDays = Number(getFlag(args, "days", "60"));
  const limit = Number(getFlag(args, "limit", "20"));
  const db = createDb();
  const now = today();
  const horizon = businessAddDays(now, horizonDays);

  const [overdue, upcoming] = await Promise.all([
    db.policy.findMany({
      where: {
        endDate: { lt: now },
        ...ACTIVE_RENEWAL_POLICY_WHERE,
      },
      include: { client: true, insurer: true, ...LATEST_RENEWAL_RECEIPT_INCLUDE },
      orderBy: { endDate: "asc" },
      take: limit,
    }),
    db.policy.findMany({
      where: {
        endDate: { gte: now, lte: horizon },
        ...ACTIVE_RENEWAL_POLICY_WHERE,
      },
      include: { client: true, insurer: true, ...LATEST_RENEWAL_RECEIPT_INCLUDE },
      orderBy: { endDate: "asc" },
      take: limit,
    }),
  ]);

  const filteredOverdue = overdue.filter((policy) =>
    shouldIncludeInRenewals(policy.status, policy.endDate, policy.receipts[0]?.status ?? null),
  );
  const filteredUpcoming = upcoming.filter((policy) =>
    shouldIncludeInRenewals(policy.status, policy.endDate, policy.receipts[0]?.status ?? null),
  );

  const upcomingTotals = summarizeByCurrency(filteredUpcoming, (policy) => policy.currency);
  const overdueTotals = summarizeByCurrency(filteredOverdue, (policy) => policy.currency);

  const formatRow = (policy: (typeof upcoming)[number]) => ({
    Poliza: policy.policyNumber,
    Cliente: policy.client.fullName,
    Aseguradora: policy.insurer.name,
    "Tipo": policy.policyType,
    Renovacion: formatDateShort(policy.endDate),
    "Dias restantes": daysUntil(policy.endDate),
    Estado: policy.status,
    Prima: formatMoney(policy.premiumAmount, policy.currency),
    Nota: compactText(policy.notes, 48) || "-",
  });

  console.log("Renovaciones proximas");
  console.log(`Horizonte: ${horizonDays} dias`);
  console.log(`Mostrando hasta ${limit} registros por bloque.`);
  console.log(`Primas en renovacion: ${filteredUpcoming.length} | ${formatCurrencyBreakdown(upcomingTotals)}`);
  console.log(`Renovaciones vencidas: ${filteredOverdue.length} | ${formatCurrencyBreakdown(overdueTotals)}`);

  printTable("Renovaciones vencidas", filteredOverdue.map(formatRow));
  printTable("Renovaciones proximas", filteredUpcoming.map(formatRow));

  console.log("");
  console.log(`Total de polizas mostradas: ${filteredOverdue.length + filteredUpcoming.length}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al listar las renovaciones.");
  console.error(error);
  process.exit(1);
});
