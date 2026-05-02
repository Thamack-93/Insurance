import { addDays } from "date-fns";
import path from "node:path";

import { daysUntil, today } from "../src/lib/dates";

import {
  closeDb,
  createDb,
  ensureDataDirs,
  exportsDir,
  formatDateShort,
  formatMoney,
  getFlag,
  parseCliArgs,
  formatCurrencyBreakdown,
  summarizeByCurrency,
  timestampForFile,
  toNumber,
  writeCsv,
  writeXlsx,
} from "./_shared";

async function main() {
  const args = parseCliArgs();
  const horizonDays = Number(getFlag(args, "days", "60"));
  const db = createDb();
  const now = today();
  const horizon = addDays(now, horizonDays);
  await ensureDataDirs();

  const receipts = await db.receipt.findMany({
    where: {
      dueDate: { gte: now, lte: horizon },
      status: { in: ["PENDING", "OVERDUE"] },
    },
    include: { client: true, insurer: true, policy: true },
    orderBy: { dueDate: "asc" },
  });

  const rows = receipts.map((receipt) => ({
    Recibo: receipt.receiptNumber,
    Cliente: receipt.client.fullName,
    Poliza: receipt.policy.policyNumber,
    Aseguradora: receipt.insurer.name,
    "Fecha vencimiento": formatDateShort(receipt.dueDate),
    "Dias restantes": daysUntil(receipt.dueDate),
    Estado: receipt.status,
    Monto: toNumber(receipt.amount),
    Moneda: receipt.currency,
    "Monto formateado": formatMoney(receipt.amount, receipt.currency),
    "Metodo de pago": receipt.paymentMethod ?? "-",
    "Fecha pago": receipt.paidDate ? formatDateShort(receipt.paidDate) : "-",
    Notas: receipt.notes ?? "-",
  }));

  const totals = summarizeByCurrency(receipts, (receipt) => receipt.currency);

  const stamp = timestampForFile();
  const csvPath = path.join(exportsDir, `due-payments-${stamp}.csv`);
  const xlsxPath = path.join(exportsDir, `due-payments-${stamp}.xlsx`);

  await writeCsv(csvPath, rows);
  await writeXlsx(xlsxPath, rows, "Pagos");

  console.log("Exportacion de pagos vencidos");
  console.log(`Horizonte: ${horizonDays} dias`);
  console.log(`Registros exportados: ${receipts.length}`);
  console.log(`Monto por moneda: ${formatCurrencyBreakdown(totals)}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Excel: ${xlsxPath}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al exportar los pagos vencidos.");
  console.error(error);
  process.exit(1);
});
