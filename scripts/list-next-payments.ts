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
  const horizonDays = Number(getFlag(args, "days", "30"));
  const limit = Number(getFlag(args, "limit", "20"));
  const db = createDb();
  const now = today();
  const horizon = addDays(now, horizonDays);

  const [overdue, upcoming] = await Promise.all([
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, insurer: true, policy: true },
      orderBy: { dueDate: "asc" },
      take: limit,
    }),
    db.receipt.findMany({
      where: {
        dueDate: { gte: now, lte: horizon },
        status: { in: ["PENDING", "OVERDUE"] },
      },
      include: { client: true, insurer: true, policy: true },
      orderBy: { dueDate: "asc" },
      take: limit,
    }),
  ]);

  const upcomingTotals = summarizeByCurrency(upcoming, (receipt) => receipt.currency);
  const overdueTotals = summarizeByCurrency(overdue, (receipt) => receipt.currency);

  const formatRow = (receipt: (typeof upcoming)[number]) => ({
    Recibo: receipt.receiptNumber,
    Cliente: receipt.client.fullName,
    Poliza: receipt.policy.policyNumber,
    Aseguradora: receipt.insurer.name,
    Vence: formatDateShort(receipt.dueDate),
    "Dias restantes": daysUntil(receipt.dueDate),
    Estado: receipt.status,
    Monto: formatMoney(receipt.amount, receipt.currency),
    "Metodo pago": receipt.paymentMethod ?? "-",
    Nota: compactText(receipt.notes, 48) || "-",
  });

  console.log("Pagos proximos");
  console.log(`Horizonte: ${horizonDays} dias`);
  console.log(`Mostrando hasta ${limit} registros por bloque.`);
  console.log(`Por vencer: ${upcoming.length} | ${formatCurrencyBreakdown(upcomingTotals)}`);
  console.log(`Vencidos: ${overdue.length} | ${formatCurrencyBreakdown(overdueTotals)}`);

  printTable("Recibos vencidos", overdue.map(formatRow));
  printTable("Recibos proximos", upcoming.map(formatRow));

  console.log("");
  console.log(`Total de registros mostrados: ${overdue.length + upcoming.length}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al listar los pagos proximos.");
  console.error(error);
  process.exit(1);
});
