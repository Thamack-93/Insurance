import Link from "next/link";
import { connection } from "next/server";
import { BadgeCheck, CircleAlert, HandCoins, TrendingUp } from "@/components/icons";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { getCommissionStats, getOverdueCommissions, autoUpdateCommissionStatuses } from "@/lib/commissions";
import { formatDate } from "@/lib/dates";
import { formatCurrency, formatCurrencyExact, toNumber } from "@/lib/money";
import { withTenantTransaction } from "@/lib/organization-context";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { commissionOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { buildTableHref, readTablePage, readTableSort } from "@/lib/table-query";
import { CommissionImportForm } from "@/components/commissions/commission-import-form";
import { SavedQueueControls } from "@/components/queues/saved-queue-controls";
import { ExportButtons } from "@/components/reports/export-buttons";
import { generateCommissionReport } from "./actions";
import { formatDateInput, parseDateInput } from "@/lib/form-utils";
import { businessAddDays } from "@/lib/business-dates";
import { allocatePaidNetPremium, deriveReceiptNetPremium, type UnitPremiumBreakdown } from "@/lib/premium-breakdown";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { commissionNavigation } from "@/lib/navigation";

function parseReportDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseDateInput(value);
  return Number.isNaN(date.getTime()) || formatDateInput(date) !== value ? null : date;
}

function commissionSnapshotMatches(commission: { calculationBreakdownJson: string | null; expectedAmount: unknown }, netPremium: number) {
  if (!commission.calculationBreakdownJson) return false;
  try {
    const snapshot = JSON.parse(commission.calculationBreakdownJson) as { breakdown?: unknown };
    if (!Array.isArray(snapshot.breakdown) || snapshot.breakdown.length === 0) return false;
    let snapshotNet = 0;
    let snapshotCommission = 0;
    for (const item of snapshot.breakdown) {
      if (!item || typeof item !== "object") return false;
      const row = item as { netPremium?: unknown; expectedAmount?: unknown; ruleId?: unknown; ruleEvidence?: unknown };
      const rowNet = Number(row.netPremium);
      const rowCommission = Number(row.expectedAmount);
      if (!Number.isFinite(rowNet) || !Number.isFinite(rowCommission) || !row.ruleId || !row.ruleEvidence) return false;
      snapshotNet += rowNet;
      snapshotCommission += rowCommission;
    }
    return Math.abs(Math.round((snapshotNet - netPremium) * 100) / 100) <= 0.01
      && Math.abs(Math.round((snapshotCommission - toNumber(commission.expectedAmount)) * 100) / 100) <= 0.01;
  } catch {
    return false;
  }
}

function commissionRateSourceLabel(commission: { calculationBreakdownJson: string | null } | null) {
  if (!commission?.calculationBreakdownJson) return "Sin dato";
  try {
    const snapshot = JSON.parse(commission.calculationBreakdownJson) as { breakdown?: unknown };
    if (!Array.isArray(snapshot.breakdown) || snapshot.breakdown.length === 0) return "Sin dato";
    const sources = snapshot.breakdown.map((item) => item && typeof item === "object" ? (item as { ruleSource?: unknown }).ruleSource : null);
    if (sources.every((source) => source === "POLICY_OVERRIDE")) return "Póliza";
    if (sources.every((source) => source === "INSURER_RULE")) return "Aseguradora";
    return "Mixta";
  } catch {
    return "Sin dato";
  }
}

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string; paidFrom?: string; paidTo?: string; generated?: string }>;
}) {
  await connection();
  const scope = await requireOrganizationPortfolioReadScope();
  // Run side-effect first; downstream reads must see the new statuses.
  await autoUpdateCommissionStatuses(scope);

  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = readTablePage(params);
  const { sortKey, direction } = readTableSort(params);
  const paidFrom = parseReportDate(params.paidFrom);
  const paidTo = parseReportDate(params.paidTo);
  const validPaidRange = Boolean(paidFrom && paidTo && paidFrom <= paidTo);
  const paidToExclusive = paidTo ? businessAddDays(paidTo, 1) : null;

  const openWhere: Prisma.CommissionWhereInput = {
    ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
    status: { notIn: ["PAID", "CANCELLED"] },
    ...(query
      ? {
          OR: [
            { policy: { policyNumber: { contains: query } } },
            { client: { fullName: { contains: query } } },
            { insurer: { name: { contains: query } } },
          ],
        }
      : {}),
  };

  const orderBy =
    sortKey === "policy"
      ? [{ policy: { policyNumber: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
      : sortKey === "client"
        ? [{ client: { fullName: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
        : sortKey === "insurer"
          ? [{ insurer: { name: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
          : sortKey === "expectedDate"
            ? [{ expectedDate: direction ?? "asc" }, { policy: { policyNumber: "asc" as const } }, { id: "asc" as const }]
            : sortKey === "amount"
              ? [{ expectedAmount: direction ?? "desc" }, { expectedDate: "asc" as const }, { id: "asc" as const }]
              : sortKey === "status"
                ? [{ status: direction ?? "asc" }, { expectedDate: "asc" as const }, { id: "asc" as const }]
                : [{ expectedDate: "asc" as const }, { id: "asc" as const }];

  const [stats, overdueCommissions, directCommissionData] = await Promise.all([
    getCommissionStats(undefined, scope),
    getOverdueCommissions(scope),
    withTenantTransaction(scope.context, async (db) => ({
      openCount: await db.commission.count({ where: openWhere }),
      openCommissions: await db.commission.findMany({
        where: openWhere,
        include: { client: true, insurer: true, policy: true, receipt: true },
        orderBy: sortKey ? orderBy : [{ expectedDate: "asc" }, { id: "asc" }],
        skip: (page - 1) * DEFAULT_PAGE_SIZE,
        take: DEFAULT_PAGE_SIZE,
      }),
      paidCommissions: await db.commission.findMany({
        where: { ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId), status: "PAID" },
        include: { client: true, insurer: true, policy: true, receipt: true },
        orderBy: [{ paidDate: "desc" }, { expectedDate: "desc" }],
        take: 10,
      }),
      paidReport: validPaidRange && paidFrom && paidToExclusive
        ? await (async () => {
            const payments = await db.payment.findMany({
              where: {
                organizationId: scope.organizationId,
                status: "POSTED",
                paidDate: { gte: paidFrom, lt: paidToExclusive },
                client: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { portfolioOwnerId: scope.portfolioOwnerId } : {}) },
                policy: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { client: { portfolioOwnerId: scope.portfolioOwnerId } } : {}) },
                receipt: { organizationId: scope.organizationId },
              },
              include: { client: true, policy: { include: { insurer: true } }, receipt: { include: { commissions: { where: { organizationId: scope.organizationId } } } } },
              orderBy: [{ paidDate: "asc" }, { id: "asc" }],
            });
            const receiptIds = [...new Set(payments.map((payment) => payment.receiptId))];
            const allPostedPayments = receiptIds.length ? await db.payment.findMany({
              where: { organizationId: scope.organizationId, status: "POSTED", receiptId: { in: receiptIds } },
              select: { id: true, receiptId: true, amount: true, currency: true },
              orderBy: [{ paidDate: "asc" }, { id: "asc" }],
            }) : [];
            return { payments, allPostedPayments };
          })()
        : { payments: [], allPostedPayments: [] },
    })),
  ]);
  const { openCount, openCommissions, paidCommissions, paidReport } = directCommissionData;

  const ratio = stats.totalExpected ? Math.round((stats.totalActual / stats.totalExpected) * 100) : 0;
  type CommissionRow = (typeof openCommissions)[number];
  type CommissionWithRelations = CommissionRow & {
    policy: NonNullable<CommissionRow["policy"]>;
    client: NonNullable<CommissionRow["client"]>;
    insurer: NonNullable<CommissionRow["insurer"]>;
    receipt: NonNullable<CommissionRow["receipt"]>;
  };
  const hasRelations = (commission: CommissionRow): commission is CommissionWithRelations =>
    Boolean(commission.policy && commission.client && commission.insurer && commission.receipt);
  const safeOpenCommissions = openCommissions.filter(hasRelations);
  const safePaidCommissions = paidCommissions.filter(hasRelations);
  const allPostedPaymentsByReceipt = new Map<string, typeof paidReport.allPostedPayments>();
  for (const row of paidReport.allPostedPayments) allPostedPaymentsByReceipt.set(row.receiptId, [...(allPostedPaymentsByReceipt.get(row.receiptId) ?? []), row]);
  const allocationsByPayment = new Map<string, { netPremium: number | null; expectedCommission: number | null }>();
  const reportReceiptsById = new Map<string, (typeof paidReport.payments)[number]["receipt"]>(paidReport.payments.map((payment) => [payment.receiptId, payment.receipt] as const));
  for (const [receiptId, receiptPayments] of allPostedPaymentsByReceipt) {
    const receipt = reportReceiptsById.get(receiptId);
    if (!receipt) continue;
    const receiptAmount = toNumber(receipt.amount);
    const totalPaid = receiptPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    const overpaid = totalPaid > receiptAmount + 0.01;
    const netPremium = deriveReceiptNetPremium({
      amount: receiptAmount,
      vatAmount: receipt.vatAmount === null ? null : toNumber(receipt.vatAmount),
      issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : toNumber(receipt.issuanceExpenseAmount),
      surchargeAmount: receipt.surchargeAmount === null ? null : toNumber(receipt.surchargeAmount),
      discountAmount: receipt.discountAmount === null ? null : toNumber(receipt.discountAmount),
      premiumBreakdownByUnit: Array.isArray(receipt.premiumBreakdownByUnit) ? receipt.premiumBreakdownByUnit as unknown as UnitPremiumBreakdown[] : null,
    });
    const commission = receipt.commissions.length === 1 && receipt.commissions[0].status !== "CANCELLED" ? receipt.commissions[0] : null;
    const sameCurrency = receiptPayments.every((payment) => payment.currency.toUpperCase() === receipt.currency.toUpperCase());
    const paidNetPremiumTotal = !overpaid && sameCurrency && netPremium !== null ? allocatePaidNetPremium(netPremium, receiptAmount, totalPaid) : null;
    const paidCommissionTotal = !overpaid && sameCurrency && commission && receiptAmount > 0
      ? Math.round((toNumber(commission.expectedAmount) * Math.min(totalPaid, receiptAmount) / receiptAmount + Number.EPSILON) * 100) / 100
      : null;
    const scale = totalPaid > 0 ? Math.min(totalPaid, receiptAmount) / totalPaid : 0;
    let netAllocated = 0;
    let commissionAllocated = 0;
    for (const [index, payment] of receiptPayments.entries()) {
      const last = index === receiptPayments.length - 1;
      const netPremiumForPayment = paidNetPremiumTotal === null ? null : last
        ? Math.round((paidNetPremiumTotal - netAllocated) * 100) / 100
        : Math.round((toNumber(payment.amount) * scale * (netPremium ?? 0) / receiptAmount + Number.EPSILON) * 100) / 100;
      const commissionForPayment = paidCommissionTotal === null ? null : last
        ? Math.round((paidCommissionTotal - commissionAllocated) * 100) / 100
        : Math.round((toNumber(payment.amount) * scale * (toNumber(commission?.expectedAmount) / receiptAmount) + Number.EPSILON) * 100) / 100;
      if (netPremiumForPayment !== null) netAllocated += netPremiumForPayment;
      if (commissionForPayment !== null) commissionAllocated += commissionForPayment;
      allocationsByPayment.set(payment.id, { netPremium: netPremiumForPayment, expectedCommission: commissionForPayment });
    }
  }
  const reportRows = paidReport.payments.map((payment) => {
    const receipt = payment.receipt;
    const amount = toNumber(payment.amount);
    const receiptAmount = toNumber(receipt.amount);
    const netPremium = deriveReceiptNetPremium({
      amount: receiptAmount,
      vatAmount: receipt.vatAmount === null ? null : toNumber(receipt.vatAmount),
      issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : toNumber(receipt.issuanceExpenseAmount),
      surchargeAmount: receipt.surchargeAmount === null ? null : toNumber(receipt.surchargeAmount),
      discountAmount: receipt.discountAmount === null ? null : toNumber(receipt.discountAmount),
      premiumBreakdownByUnit: Array.isArray(receipt.premiumBreakdownByUnit) ? receipt.premiumBreakdownByUnit as unknown as UnitPremiumBreakdown[] : null,
    });
    const commission = receipt.commissions.length === 1 ? receipt.commissions[0] : null;
    const allReceiptPayments = allPostedPaymentsByReceipt.get(payment.receiptId) ?? [];
    const reasons: string[] = [];
    if (receipt.status === "CANCELLED") reasons.push("El recibo está cancelado; requiere revisión.");
    if (receipt.commissions.length > 1) reasons.push("Hay más de una comisión asociada al recibo.");
    if (!commission) reasons.push(receipt.commissionReviewReason ?? "No hay una comisión calculada con regla exacta.");
    if (commission && receipt.commissionCalculationStatus === "REVIEW" && receipt.commissionReviewReason) reasons.push(receipt.commissionReviewReason);
    if (commission?.status === "CANCELLED") reasons.push("La comisión asociada está cancelada.");
    if (receiptAmount <= 0) reasons.push("El importe del recibo no permite prorratear el pago.");
    if (allReceiptPayments.some((postedPayment) => postedPayment.currency.toUpperCase() !== receipt.currency.toUpperCase())) reasons.push("La moneda de uno o más pagos no coincide con la del recibo.");
    if (netPremium === null) reasons.push("Falta el desglose necesario para obtener la prima neta.");
    if (commission && netPremium !== null && !commissionSnapshotMatches(commission, netPremium)) reasons.push("La evidencia de comisión no coincide con el desglose actual del recibo.");
    const allPostedTotal = allReceiptPayments.reduce((sum, postedPayment) => sum + toNumber(postedPayment.amount), 0);
    if (allPostedTotal > receiptAmount + 0.01) reasons.push("Los pagos POSTED exceden el importe del recibo.");
    const calculated = Boolean(commission && commission.status !== "CANCELLED" && receiptAmount > 0 && !reasons.length);
    const allocation = allocationsByPayment.get(payment.id);
    const allocatedNetPremium = netPremium === null || reasons.some((reason) => reason.includes("moneda") || reason.includes("exceden")) ? null : allocation?.netPremium ?? null;
    const expectedCommission = calculated ? allocation?.expectedCommission ?? null : null;
    return { payment, receipt, commission, amount, allocatedNetPremium, expectedCommission, status: calculated ? "CALCULATED" as const : "REVIEW" as const, reason: reasons.join(" "), reasonList: reasons };
  });
  const totalsByCurrency = new Map<string, { premiumPaid: number; commissionExpected: number }>();
  for (const row of reportRows) {
    const currency = row.payment.currency;
    const total = totalsByCurrency.get(currency) ?? { premiumPaid: 0, commissionExpected: 0 };
    total.premiumPaid += row.amount;
    if (row.expectedCommission !== null) total.commissionExpected += row.expectedCommission;
    totalsByCurrency.set(currency, total);
  }
  const paidCount = stats.statusBreakdown.find(({ status }) => status === "PAID")?.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <SavedQueueControls route="commissions" config={{ route: "commissions", search: query, filters: {}, sort: sortKey ?? "", dateWindow: "30d", version: 1 }} />
        <PageHeader
          eyebrow="Finanzas"
          title="Comisiones"
          description="Calcula y descarga comisiones estimadas a partir de las primas que pagaron los clientes."
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LocalNavigation items={commissionNavigation} label="Comisiones y bonos" variant="compact" />
          <div className="flex flex-wrap items-center gap-2">
            <CommissionImportForm />
            <Button asChild variant="outline"><Link href="/commissions/rules">Reglas de comisión</Link></Button>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Esperado"
            value={formatCurrency(stats.totalExpected)}
            description="Suma de comisiones registradas."
            icon={HandCoins}
            tone="emerald"
          />
          <MetricCard
            title="Cobrado"
            value={formatCurrency(stats.totalActual)}
            description={`${ratio}% de conversión sobre lo esperado`}
            icon={TrendingUp}
            tone="blue"
          />
          <MetricCard
            title="Abiertas"
            value={stats.totalCount - paidCount}
            description="Todavía en espera de liquidación."
            icon={BadgeCheck}
            tone="amber"
          />
          <MetricCard
            title="Vencidas"
            value={overdueCommissions.length}
            description="Esperadas en el pasado sin cierre."
            icon={CircleAlert}
            tone="rose"
          />
        </section>

        <SectionCard title="Generar reporte de comisiones" description="El periodo usa la fecha de pago de la prima por el cliente. Se incluyen pagos POSTED y se excluyen los revertidos.">
          {scope.membershipRole === "AGENT" ? <p className="border-b px-4 py-3 text-sm text-muted-foreground">Puedes consultar los pagos y comisiones de tu cartera. Solo Owner o Admin puede calcular las comisiones faltantes.</p> : (
            <form action={generateCommissionReport} className="flex flex-wrap items-end gap-3 border-b px-4 py-4">
              <label className="grid gap-1 text-sm">Desde<input required type="date" name="paidFrom" defaultValue={params.paidFrom} className="h-10 rounded-md border bg-background px-3" /></label>
              <label className="grid gap-1 text-sm">Hasta<input required type="date" name="paidTo" defaultValue={params.paidTo} className="h-10 rounded-md border bg-background px-3" /></label>
              <Button type="submit">Calcular y generar reporte</Button>
            </form>
          )}
          <p className="px-4 py-3 text-xs text-muted-foreground">Prima neta del recibo = importe − IVA − expedición − recargo fraccionado + descuentos visibles. Prima neta pagada = prima neta × pago POSTED / importe del recibo; la comisión calculada del recibo se distribuye con esa misma proporción. Los faltantes de regla, desglose, conciliación o duplicidad quedan en revisión.</p>
          {params.generated === "1" ? <p className="border-b px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">Periodo procesado. Revisa las partidas marcadas antes de usar el reporte.</p> : null}
          {params.paidFrom || params.paidTo ? validPaidRange ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-sm">{reportRows.length} pago(s) del cliente · {reportRows.filter((row) => row.status === "REVIEW").length} en revisión · {totalsByCurrency.size ? [...totalsByCurrency.entries()].map(([currency, totals]) => `Prima pagada ${formatCurrencyExact(totals.premiumPaid, currency)} · Comisión estimada ${formatCurrencyExact(totals.commissionExpected, currency)}`).join("; ") : "Sin pagos en el periodo"}</p>
                <ExportButtons exports={[{ name: "Comisiones por pago", data: reportRows.map(({ payment, receipt, commission, amount, allocatedNetPremium, expectedCommission, status, reason }) => ({
                  "Fecha de pago del cliente": payment.paidDate.toISOString().slice(0, 10),
                  "Referencia de pago": payment.reference ?? "",
                  "Póliza": payment.policy.policyNumber,
                  "Recibo": receipt.receiptNumber,
                  "Cliente": payment.client.fullName,
                  "Aseguradora": payment.policy.insurer.name,
                  "Prima pagada": amount.toFixed(2),
                  "Prima neta atribuida": allocatedNetPremium?.toFixed(2) ?? "",
                  "Tasa efectiva (%)": commission?.percentage === null || commission?.percentage === undefined ? "" : toNumber(commission.percentage).toFixed(4),
                  "Origen de tasa": commissionRateSourceLabel(commission),
                  "Comisión estimada": expectedCommission?.toFixed(2) ?? "",
                  "Moneda": payment.currency,
                  "Estado": status === "CALCULATED" ? "Calculada" : "Revisión",
                  "Motivo": reason,
                })) }]} />
              </div>
              {reportRows.length ? <>
                <p className="px-4 pb-2 text-xs text-muted-foreground">Desplaza la tabla horizontalmente para consultar todas las columnas. Abre “Revisión” para ver el detalle del dato pendiente.</p>
                <Table className="min-w-[1340px] table-fixed">
                  <TableHeader><TableRow className="bg-muted/40">
                    <TableHead className="w-[120px]">Pago cliente</TableHead><TableHead className="w-[130px]">Póliza / recibo</TableHead><TableHead className="w-[175px]">Cliente</TableHead><TableHead className="w-[180px]">Aseguradora</TableHead><TableHead className="w-[130px] text-right">Prima pagada</TableHead><TableHead className="w-[140px] text-right">Prima neta pagada</TableHead><TableHead className="w-[75px] text-right">Tasa</TableHead><TableHead className="w-[150px] text-right">Comisión estimada</TableHead><TableHead className="w-[240px]">Estado / revisión</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{reportRows.map(({ payment, receipt, commission, amount, allocatedNetPremium, expectedCommission, status, reasonList }) => <TableRow key={payment.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(payment.paidDate)}</TableCell>
                    <TableCell className="truncate"><Link href={`/policies/${payment.policyId}`} className="font-medium hover:text-primary">{payment.policy.policyNumber}</Link><p className="truncate text-xs text-muted-foreground">{receipt.receiptNumber}</p></TableCell>
                    <TableCell className="truncate" title={payment.client.fullName}>{payment.client.fullName}</TableCell><TableCell className="truncate" title={payment.policy.insurer.name}>{payment.policy.insurer.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrencyExact(amount, payment.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{allocatedNetPremium === null ? "—" : formatCurrencyExact(allocatedNetPremium, payment.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {commission?.percentage === null || commission?.percentage === undefined ? "—" : <span>{toNumber(commission.percentage).toFixed(2)}%<span className="block text-xs font-normal text-muted-foreground">{commissionRateSourceLabel(commission)}</span></span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{expectedCommission === null ? "—" : formatCurrencyExact(expectedCommission, payment.currency)}</TableCell>
                    <TableCell className="text-xs">{status === "CALCULATED" ? <StatusBadge status="EXPECTED" entity="commission" /> : <details className="group">
                      <summary className="inline-flex cursor-pointer list-none items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950">
                        Revisión{reasonList.length > 1 ? ` · ${reasonList.length} pendientes` : " · Ver motivo"}
                      </summary>
                      <div className="mt-2 max-w-[230px] space-y-1.5 whitespace-normal rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                        {reasonList.map((item, index) => <p key={`${payment.id}-reason-${index}`}>{item}</p>)}
                      </div>
                    </details>}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">No hay pagos de prima POSTED dentro de ese periodo.</p>}
            </>
          ) : <p className="px-4 py-4 text-sm text-amber-700 dark:text-amber-300">Ingresa fechas válidas y asegúrate de que “Desde” no sea posterior a “Hasta”.</p> : <p className="px-4 py-4 text-sm text-muted-foreground">Elige el periodo que quieres consultar. Al generarlo, el sistema calcula las comisiones faltantes y muestra cada pago del cliente.</p>}
        </SectionCard>

        <SectionCard
          title="Comisiones abiertas"
          description="Listado paginado con búsqueda por póliza, cliente o aseguradora."
          action={<TableToolbar searchPlaceholder="Buscar por póliza, cliente o aseguradora..." />}
        >
          {safeOpenCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={HandCoins}
                title={query ? "Sin resultados" : "Sin comisiones abiertas"}
                description={
                  query
                    ? `No encontramos comisiones que coincidan con "${query}".`
                    : "Al generar un reporte para un periodo con primas pagadas, las comisiones calculadas aparecerán aquí."
                }
              />
            </div>
          ) : safeOpenCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={HandCoins}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action={{ label: "Volver al inicio", href: buildTableHref("/commissions", params, { q: query || null, sort: sortKey ?? null, dir: direction ?? null, }) }}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <SortableTableHead sortKey="policy">Póliza</SortableTableHead>
                    <SortableTableHead sortKey="client">Cliente</SortableTableHead>
                    <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
                    <SortableTableHead sortKey="expectedDate">Esperada</SortableTableHead>
                    <SortableTableHead sortKey="amount" className="text-right">
                      Monto
                    </SortableTableHead>
                    <SortableTableHead sortKey="status">Estado</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {safeOpenCommissions.map((commission) => (
                    <TableRow key={commission.id}>
                      <TableCell>
                        <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                          {commission.policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{commission.client.fullName}</TableCell>
                      <TableCell>{commission.insurer.name}</TableCell>
                      <TableCell>{formatDate(commission.expectedDate)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(toNumber(commission.expectedAmount))}</TableCell>
                      <TableCell>
                        <StatusBadge status={commission.status} entity="commission" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={openCount}
                basePath="/commissions"
                searchParams={{ q: query, sort: sortKey ?? undefined, dir: direction ?? undefined }}
              />
            </>
          )}
        </SectionCard>

        <SectionCard title="Comisiones cobradas" description="Últimos cierres que ya entraron a caja.">
          {safePaidCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={BadgeCheck}
                title="Sin comisiones cobradas"
                description="Cuando registres pagos de comisión, aparecerán aquí los cierres más recientes."
              />
            </div>
          ) : (
            <div className="divide-y divide-stone-200/80">
              {safePaidCommissions.map((commission) => (
                <div key={commission.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {commission.policy.policyNumber}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.client.fullName} · {commission.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {commission.paidDate ? formatDate(commission.paidDate) : formatDate(commission.expectedDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(toNumber(commission.actualAmount ?? commission.expectedAmount))}</p>
                    <StatusBadge status={commission.status} entity="commission" className="mt-1 w-fit" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
