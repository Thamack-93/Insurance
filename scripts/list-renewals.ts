import { addDays } from "date-fns";

import { daysUntil, today } from "../src/lib/dates.ts";

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
  const horizon = addDays(now, horizonDays);

  const [overdue, upcoming] = await Promise.all([
    db.policy.findMany({
      where: {
        renewalDate: { lt: now },
        status: { notIn: ["RENEWED", "CANCELLED"] },
      },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: limit,
    }),
    db.policy.findMany({
      where: {
        renewalDate: { gte: now, lte: horizon },
        status: "ACTIVE",
      },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: limit,
    }),
  ]);

  const upcomingTotals = summarizeByCurrency(upcoming, (policy) => policy.currency);
  const overdueTotals = summarizeByCurrency(overdue, (policy) => policy.currency);

  const formatRow = (policy: (typeof upcoming)[number]) => ({
    Poliza: policy.policyNumber,
    Cliente: policy.client.fullName,
    Aseguradora: policy.insurer.name,
    "Tipo": policy.policyType,
    Renovacion: formatDateShort(policy.renewalDate),
    "Dias restantes": daysUntil(policy.renewalDate ?? now),
    Estado: policy.status,
    Prima: formatMoney(policy.premiumAmount, policy.currency),
    Nota: compactText(policy.notes, 48) || "-",
  });

  console.log("Renovaciones proximas");
  console.log(`Horizonte: ${horizonDays} dias`);
  console.log(`Mostrando hasta ${limit} registros por bloque.`);
  console.log(`Primas en renovacion: ${upcoming.length} | ${formatCurrencyBreakdown(upcomingTotals)}`);
  console.log(`Renovaciones vencidas: ${overdue.length} | ${formatCurrencyBreakdown(overdueTotals)}`);

  printTable("Renovaciones vencidas", overdue.map(formatRow));
  printTable("Renovaciones proximas", upcoming.map(formatRow));

  console.log("");
  console.log(`Total de polizas mostradas: ${overdue.length + upcoming.length}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al listar las renovaciones.");
  console.error(error);
  process.exit(1);
});
