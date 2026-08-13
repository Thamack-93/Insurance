import path from "node:path";

import {
  closeDb,
  createDb,
  formatCurrencyBreakdown,
  ensureDataDirs,
  exportsDir,
  formatDateShort,
  formatMoney,
  parseCliArgs,
  requireOrganizationId,
  summarizeByCurrency,
  timestampForFile,
  toNumber,
  writeCsv,
  writeXlsx,
} from "./_shared.ts";

async function main() {
  const organizationId = requireOrganizationId(parseCliArgs());
  const db = createDb();
  await ensureDataDirs();

  const commissions = await db.commission.findMany({
    where: { organizationId, status: { not: "CANCELLED" } },
    include: { client: true, insurer: true, policy: true, receipt: true },
    orderBy: [{ expectedDate: "asc" }, { createdAt: "asc" }],
  });

  const rows = commissions.map((commission) => ({
    Poliza: commission.policy.policyNumber,
    Recibo: commission.receipt?.receiptNumber ?? "-",
    Cliente: commission.client.fullName,
    Aseguradora: commission.insurer.name,
    Estado: commission.status,
    "Fecha esperada": formatDateShort(commission.expectedDate),
    "Fecha pago": commission.paidDate ? formatDateShort(commission.paidDate) : "-",
    "Monto esperado": toNumber(commission.expectedAmount),
    "Monto real": commission.actualAmount ? toNumber(commission.actualAmount) : "-",
    Porcentaje: commission.percentage ? toNumber(commission.percentage) : "-",
    "Monto esperado formateado": formatMoney(commission.expectedAmount, commission.policy.currency),
    "Monto real formateado": commission.actualAmount
      ? formatMoney(commission.actualAmount, commission.policy.currency)
      : "-",
    Notas: commission.notes ?? "-",
  }));

  const totals = summarizeByCurrency(
    commissions,
    (commission) => commission.policy.currency,
    (commission) => commission.actualAmount ?? commission.expectedAmount,
  );

  const stamp = timestampForFile();
  const csvPath = path.join(exportsDir, `commissions-${stamp}.csv`);
  const xlsxPath = path.join(exportsDir, `commissions-${stamp}.xlsx`);

  await writeCsv(csvPath, rows);
  await writeXlsx(xlsxPath, rows, "Comisiones");

  console.log("Exportacion de comisiones");
  console.log(`Registros exportados: ${commissions.length}`);
  console.log(`Monto por moneda: ${formatCurrencyBreakdown(totals)}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Excel: ${xlsxPath}`);

  await closeDb(db);
}

main().catch((error) => {
  console.error("Error al exportar las comisiones.");
  console.error(error);
  process.exit(1);
});
