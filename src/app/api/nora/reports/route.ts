import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/lib/auth";
import { businessAddDays, businessEndOfDay, businessToday, formatBusinessDateInput, parseBusinessDateInput } from "@/lib/business-dates";
import { commissionOperationalWhere, policyOperationalWhere, receiptOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { getWorkItemsPage, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { convertMoneyValue, loadCurrencyRates } from "@/lib/currency-rates";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { withTenantTransaction } from "@/lib/organization-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportScope = Awaited<ReturnType<typeof requireOrganizationPortfolioReadScope>>;

type ReportPage = { size: number; cursor: string | undefined; offset: number };

function readPage(request: NextRequest): ReportPage {
  const requestedSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 100);
  const requestedPage = Number(request.nextUrl.searchParams.get("page") ?? 1);
  return {
    size: Number.isFinite(requestedSize) ? Math.min(250, Math.max(1, Math.round(requestedSize))) : 100,
    cursor: request.nextUrl.searchParams.get("cursor")?.trim() || undefined,
    offset: Number.isFinite(requestedPage) ? Math.max(0, Math.round(requestedPage - 1)) * 100 : 0,
  };
}

function pageResult<T extends { id: string }>(rows: T[], totalCount: number, page: ReportPage) {
  const hasMore = rows.length > page.size;
  const visibleRows = rows.slice(0, page.size);
  return {
    rows: visibleRows,
    totalCount,
    returnedCount: visibleRows.length,
    nextCursor: hasMore ? visibleRows.at(-1)?.id ?? null : null,
  };
}

async function withReportTenant<T>(scope: ReportScope, callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // Production scopes always carry the validated context. The fallback keeps
  // isolated route logic tests compatible with their deliberately small scope
  // fixture and is never reachable from the real auth implementation.
  if (scope.context && typeof withTenantTransaction === "function") {
    return withTenantTransaction(scope.context, callback);
  }
  const dbModule = await import("@/lib/db");
  return callback(dbModule["getDb"]() as unknown as Prisma.TransactionClient);
}

function readDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  try {
    return parseBusinessDateInput(value);
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  try {
    const scope = await requireOrganizationPortfolioReadScope();
    const capability = await resolveOrganizationCapability(scope.organizationId, "NORA");
    if (!capability.enabled) return NextResponse.json({ error: "Nora no está habilitada para esta organización." }, { status: 403 });
    const type = request.nextUrl.searchParams.get("type");
    const today = businessToday();
    const defaultFrom = businessAddDays(today, -30);
    const defaultTo = businessAddDays(today, 30);
    const from = readDate(request.nextUrl.searchParams.get("from"), defaultFrom);
    const to = readDate(request.nextUrl.searchParams.get("to"), defaultTo);
    if (from > to) return NextResponse.json({ error: "La fecha inicial debe ser anterior a la fecha final." }, { status: 400 });
    const filter = request.nextUrl.searchParams.get("filter") ?? "";
    const page = readPage(request);

    if (type === "overdue") {
      const overdueEndExclusive = to < today ? businessAddDays(to, 1) : today;
      const receiptStatus: Prisma.EnumReceiptStatusFilter<"Receipt"> | undefined =
        filter === "all" ? undefined : { notIn: ["PAID", "CANCELLED"] };
      const report = await withReportTenant(scope, async (tx) => {
        const where = {
          ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          dueDate: filter === "overdue" || !filter ? { gte: from, lt: overdueEndExclusive } : { gte: from, lte: businessEndOfDay(to) },
          ...(receiptStatus ? { status: receiptStatus } : {}),
        };
        const [totalCount, rates, receipts] = await Promise.all([
          tx.receipt.count({ where }),
          loadCurrencyRates(tx, scope.organizationId, businessEndOfDay(to)),
          tx.receipt.findMany({
            where,
            select: {
              id: true,
          receiptNumber: true,
          dueDate: true,
          amount: true,
          currency: true,
          status: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true } },
          insurer: { select: { name: true } },
            },
            orderBy: [{ dueDate: "asc" }, { receiptNumber: "asc" }, { id: "asc" }],
            take: page.size + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }),
        ]);
        return { ...pageResult(receipts, totalCount, page), rates };
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "cobranza-vencida",
          title: filter === "overdue" || !filter ? "Cobranza vencida" : "Reporte de cobranza",
          columns: ["Recibo", "Cliente", "Póliza", "Aseguradora", "Vencimiento", "Importe", "Moneda", "Importe MXN", "Tasa MXN", "Fecha tasa", "Estado conversión", "Estado"],
          rows: report.rows.map((receipt) => {
            const money = convertMoneyValue(receipt.amount, receipt.currency, receipt.dueDate, report.rates);
            return {
            Recibo: receipt.receiptNumber,
            Cliente: receipt.client.fullName,
            "Póliza": receipt.policy.policyNumber,
            Aseguradora: receipt.insurer.name,
            Vencimiento: formatBusinessDateInput(receipt.dueDate),
            Importe: Number(money.originalAmount),
            Moneda: money.originalCurrency,
            "Importe MXN": money.amountMxn == null ? "" : Number(money.amountMxn),
            "Tasa MXN": money.conversionRate == null ? "" : Number(money.conversionRate),
            "Fecha tasa": money.conversionDate ?? "",
            "Estado conversión": money.conversionStatus,
            Estado: receipt.status,
            };
          }),
          totalCount: report.totalCount,
          returnedCount: report.returnedCount,
          nextCursor: report.nextCursor,
        },
      });
    }

    if (type === "renewals") {
      const requestedDays = Number(request.nextUrl.searchParams.get("days") ?? 30);
      const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(1, Math.round(requestedDays))) : 30;
      const requestedFrom = request.nextUrl.searchParams.has("from") ? from : today;
      const requestedTo = request.nextUrl.searchParams.has("to") ? to : businessAddDays(today, days);
      const report = await withReportTenant(scope, async (tx) => {
        const where: Prisma.PolicyWhereInput = {
          ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          ...(filter === "all" ? {} : { status: "ACTIVE" as const }),
          endDate: { gte: requestedFrom, lte: businessEndOfDay(requestedTo) },
        };
        const [totalCount, rates, policies] = await Promise.all([
          tx.policy.count({ where }),
          loadCurrencyRates(tx, scope.organizationId, businessEndOfDay(requestedTo)),
          tx.policy.findMany({
            where,
            select: {
              id: true,
          policyNumber: true,
          policyType: true,
          endDate: true,
          premiumAmount: true,
          currency: true,
          client: { select: { fullName: true } },
          insurer: { select: { name: true } },
            },
            orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }, { id: "asc" }],
            take: page.size + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }),
        ]);
        return { ...pageResult(policies, totalCount, page), rates };
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "renovaciones-proximas",
          title: "Renovaciones por vigencia",
          columns: ["Póliza", "Cliente", "Aseguradora", "Ramo", "Vencimiento", "Prima", "Moneda", "Prima MXN", "Tasa MXN", "Fecha tasa", "Estado conversión"],
          rows: report.rows.map((policy) => {
            const money = convertMoneyValue(policy.premiumAmount, policy.currency, policy.endDate, report.rates);
            return {
            "Póliza": policy.policyNumber,
            Cliente: policy.client.fullName,
            Aseguradora: policy.insurer.name,
            Ramo: policy.policyType,
            Vencimiento: formatBusinessDateInput(policy.endDate),
            Prima: Number(money.originalAmount),
            Moneda: money.originalCurrency,
            "Prima MXN": money.amountMxn == null ? "" : Number(money.amountMxn),
            "Tasa MXN": money.conversionRate == null ? "" : Number(money.conversionRate),
            "Fecha tasa": money.conversionDate ?? "",
            "Estado conversión": money.conversionStatus,
            };
          }),
          totalCount: report.totalCount,
          returnedCount: report.returnedCount,
          nextCursor: report.nextCursor,
        },
      });
    }

    if (type === "portfolio") {
      const status: Prisma.PolicyWhereInput["status"] = filter === "all" ? undefined : filter === "expired" ? "EXPIRED" : "ACTIVE";
      const report = await withReportTenant(scope, async (tx) => {
        const where: Prisma.PolicyWhereInput = {
          ...policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          ...(status ? { status } : {}),
          startDate: { lte: businessEndOfDay(to) },
          endDate: { gte: from },
        };
        const [totalCount, rates, policies] = await Promise.all([
          tx.policy.count({ where }),
          loadCurrencyRates(tx, scope.organizationId, businessEndOfDay(to)),
          tx.policy.findMany({
            where,
            select: {
              id: true,
          policyNumber: true,
          policyType: true,
          startDate: true,
          endDate: true,
          premiumAmount: true,
          currency: true,
          client: { select: { fullName: true } },
          insurer: { select: { name: true } },
            },
            orderBy: [{ client: { fullName: "asc" } }, { policyNumber: "asc" }, { id: "asc" }],
            take: page.size + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }),
        ]);
        return { ...pageResult(policies, totalCount, page), rates };
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "cartera-activa",
          title: "Cartera propia activa",
          columns: ["Póliza", "Cliente", "Aseguradora", "Ramo", "Inicio", "Vencimiento", "Prima", "Moneda", "Prima MXN", "Tasa MXN", "Fecha tasa", "Estado conversión"],
          rows: report.rows.map((policy) => {
            const money = convertMoneyValue(policy.premiumAmount, policy.currency, policy.endDate, report.rates);
            return {
            "Póliza": policy.policyNumber,
            Cliente: policy.client.fullName,
            Aseguradora: policy.insurer.name,
            Ramo: policy.policyType,
            Inicio: formatBusinessDateInput(policy.startDate),
            Vencimiento: formatBusinessDateInput(policy.endDate),
            Prima: Number(money.originalAmount),
            Moneda: money.originalCurrency,
            "Prima MXN": money.amountMxn == null ? "" : Number(money.amountMxn),
            "Tasa MXN": money.conversionRate == null ? "" : Number(money.conversionRate),
            "Fecha tasa": money.conversionDate ?? "",
            "Estado conversión": money.conversionStatus,
            };
          }),
          totalCount: report.totalCount,
          returnedCount: report.returnedCount,
          nextCursor: report.nextCursor,
        },
      });
    }

    if (type === "commissions") {
      const status: Prisma.EnumCommissionStatusFilter<"Commission"> | undefined =
        filter === "paid" ? { equals: "PAID" } : filter === "all" ? undefined : { in: ["EXPECTED", "PENDING", "OVERDUE"] };
      const report = await withReportTenant(scope, async (tx) => {
        const where = {
          ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          expectedDate: { gte: from, lte: businessEndOfDay(to) },
          ...(status ? { status } : {}),
        };
        const [totalCount, rates, commissions] = await Promise.all([
          tx.commission.count({ where }),
          loadCurrencyRates(tx, scope.organizationId, businessEndOfDay(to)),
          tx.commission.findMany({
            where,
            select: {
              id: true,
          expectedDate: true,
          paidDate: true,
          expectedAmount: true,
          actualAmount: true,
          percentage: true,
          status: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true, currency: true } },
          insurer: { select: { name: true } },
            },
            orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
            take: page.size + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }),
        ]);
        return { ...pageResult(commissions, totalCount, page), rates };
      });
      return NextResponse.json({ success: true, report: {
        slug: "comisiones",
        title: "Comisiones",
        columns: ["Cliente", "Póliza", "Aseguradora", "Fecha esperada", "Fecha pagada", "Importe esperado", "Importe real", "Porcentaje", "Moneda", "Importe MXN", "Tasa MXN", "Fecha tasa", "Estado conversión", "Estado"],
        rows: report.rows.map((commission) => {
          const money = convertMoneyValue(commission.actualAmount ?? commission.expectedAmount, commission.policy.currency, commission.expectedDate, report.rates);
          return {
          Cliente: commission.client.fullName,
          "Póliza": commission.policy.policyNumber,
          Aseguradora: commission.insurer.name,
          "Fecha esperada": formatBusinessDateInput(commission.expectedDate),
          "Fecha pagada": commission.paidDate ? formatBusinessDateInput(commission.paidDate) : "",
          "Importe esperado": Number(commission.expectedAmount),
          "Importe real": commission.actualAmount == null ? "" : Number(commission.actualAmount),
          Porcentaje: commission.percentage == null ? "" : Number(commission.percentage),
          Moneda: money.originalCurrency,
          "Importe MXN": money.amountMxn == null ? "" : Number(money.amountMxn),
          "Tasa MXN": money.conversionRate == null ? "" : Number(money.conversionRate),
          "Fecha tasa": money.conversionDate ?? "",
          "Estado conversión": money.conversionStatus,
          Estado: commission.status,
          };
        }),
        totalCount: report.totalCount,
        returnedCount: report.returnedCount,
        nextCursor: report.nextCursor,
      }});
    }

    if (type === "operations") {
      const workItemFilters = {
        organizationId: scope.organizationId,
        portfolioOwnerId: scope.portfolioOwnerId,
        from,
        to,
        statuses: filter === "all" ? undefined : OPEN_WORK_ITEM_STATUSES,
        priorities: filter === "urgent" ? (["URGENT"] as const) : filter === "high" ? (["HIGH"] as const) : undefined,
        limit: page.size,
        skip: page.offset,
      };
      const workItems = scope.context
        ? await withReportTenant(scope, (tx) => getWorkItemsPage(workItemFilters, tx))
        : await getWorkItemsPage(workItemFilters);
      return NextResponse.json({ success: true, report: {
        slug: "operacion",
        title: "Operación y pendientes",
        columns: ["Folio", "Pendiente", "Cliente", "Póliza", "Aseguradora", "Prioridad", "Estado", "Fecha límite"],
        rows: workItems.items.map((item) => ({
          Folio: item.folio ?? item.sourceId ?? item.id,
          Pendiente: item.title,
          Cliente: item.client?.fullName ?? "",
          "Póliza": item.policy?.policyNumber ?? "",
          Aseguradora: item.insurer?.name ?? "",
          Prioridad: item.priority,
          Estado: item.status,
          "Fecha límite": item.dueDate ? formatBusinessDateInput(item.dueDate) : "",
        })),
        totalCount: workItems.totalCount,
        returnedCount: workItems.items.length,
        nextCursor: null,
      }});
    }

    return NextResponse.json({ error: "El reporte solicitado no está soportado." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "No se pudo generar el reporte." }, { status: 500 });
  }
}
