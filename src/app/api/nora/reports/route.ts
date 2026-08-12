import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/lib/auth";
import { businessAddDays, businessEndOfDay, businessToday, formatBusinessDateInput, parseBusinessDateInput } from "@/lib/business-dates";
import { getDb } from "@/lib/db";
import { commissionOperationalWhere, policyOperationalWhere, receiptOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const scope = await requirePortfolioReadScope();
    const db = getDb();
    const type = request.nextUrl.searchParams.get("type");
    const today = businessToday();
    const defaultFrom = businessAddDays(today, -30);
    const defaultTo = businessAddDays(today, 30);
    const from = readDate(request.nextUrl.searchParams.get("from"), defaultFrom);
    const to = readDate(request.nextUrl.searchParams.get("to"), defaultTo);
    if (from > to) return NextResponse.json({ error: "La fecha inicial debe ser anterior a la fecha final." }, { status: 400 });
    const filter = request.nextUrl.searchParams.get("filter") ?? "";

    if (type === "overdue") {
      const overdueEndExclusive = to < today ? businessAddDays(to, 1) : today;
      const receiptStatus: Prisma.EnumReceiptStatusFilter<"Receipt"> | undefined =
        filter === "all" ? undefined : { notIn: ["PAID", "CANCELLED"] };
      const receipts = await db.receipt.findMany({
        where: {
          ...receiptOperationalWhere(scope.portfolioOwnerId),
          dueDate: filter === "overdue" || !filter ? { gte: from, lt: overdueEndExclusive } : { gte: from, lte: businessEndOfDay(to) },
          ...(receiptStatus ? { status: receiptStatus } : {}),
        },
        select: {
          receiptNumber: true,
          dueDate: true,
          amount: true,
          currency: true,
          status: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true } },
          insurer: { select: { name: true } },
        },
        orderBy: [{ dueDate: "asc" }, { receiptNumber: "asc" }],
        take: 1000,
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "cobranza-vencida",
          title: filter === "overdue" || !filter ? "Cobranza vencida" : "Reporte de cobranza",
          columns: ["Recibo", "Cliente", "Póliza", "Aseguradora", "Vencimiento", "Importe", "Moneda", "Estado"],
          rows: receipts.map((receipt) => ({
            Recibo: receipt.receiptNumber,
            Cliente: receipt.client.fullName,
            "Póliza": receipt.policy.policyNumber,
            Aseguradora: receipt.insurer.name,
            Vencimiento: formatBusinessDateInput(receipt.dueDate),
            Importe: Number(receipt.amount),
            Moneda: receipt.currency,
            Estado: receipt.status,
          })),
        },
      });
    }

    if (type === "renewals") {
      const requestedDays = Number(request.nextUrl.searchParams.get("days") ?? 30);
      const days = Number.isFinite(requestedDays) ? Math.min(365, Math.max(1, Math.round(requestedDays))) : 30;
      const requestedFrom = request.nextUrl.searchParams.has("from") ? from : today;
      const requestedTo = request.nextUrl.searchParams.has("to") ? to : businessAddDays(today, days);
      const policies = await db.policy.findMany({
        where: {
          ...policyOperationalWhere(scope.portfolioOwnerId),
          ...(filter === "all" ? {} : { status: "ACTIVE" }),
          endDate: { gte: requestedFrom, lte: businessEndOfDay(requestedTo) },
        },
        select: {
          policyNumber: true,
          policyType: true,
          endDate: true,
          premiumAmount: true,
          currency: true,
          client: { select: { fullName: true } },
          insurer: { select: { name: true } },
        },
        orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
        take: 1000,
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "renovaciones-proximas",
          title: "Renovaciones por vigencia",
          columns: ["Póliza", "Cliente", "Aseguradora", "Ramo", "Vencimiento", "Prima", "Moneda"],
          rows: policies.map((policy) => ({
            "Póliza": policy.policyNumber,
            Cliente: policy.client.fullName,
            Aseguradora: policy.insurer.name,
            Ramo: policy.policyType,
            Vencimiento: formatBusinessDateInput(policy.endDate),
            Prima: Number(policy.premiumAmount),
            Moneda: policy.currency,
          })),
        },
      });
    }

    if (type === "portfolio") {
      const status = filter === "all" ? undefined : filter === "expired" ? "EXPIRED" : "ACTIVE";
      const policies = await db.policy.findMany({
        where: {
          ...policyOperationalWhere(scope.portfolioOwnerId),
          ...(status ? { status } : {}),
          startDate: { lte: businessEndOfDay(to) },
          endDate: { gte: from },
        },
        select: {
          policyNumber: true,
          policyType: true,
          startDate: true,
          endDate: true,
          premiumAmount: true,
          currency: true,
          client: { select: { fullName: true } },
          insurer: { select: { name: true } },
        },
        orderBy: [{ client: { fullName: "asc" } }, { policyNumber: "asc" }],
        take: 1000,
      });
      return NextResponse.json({
        success: true,
        report: {
          slug: "cartera-activa",
          title: "Cartera propia activa",
          columns: ["Póliza", "Cliente", "Aseguradora", "Ramo", "Inicio", "Vencimiento", "Prima", "Moneda"],
          rows: policies.map((policy) => ({
            "Póliza": policy.policyNumber,
            Cliente: policy.client.fullName,
            Aseguradora: policy.insurer.name,
            Ramo: policy.policyType,
            Inicio: formatBusinessDateInput(policy.startDate),
            Vencimiento: formatBusinessDateInput(policy.endDate),
            Prima: Number(policy.premiumAmount),
            Moneda: policy.currency,
          })),
        },
      });
    }

    if (type === "commissions") {
      const status: Prisma.EnumCommissionStatusFilter<"Commission"> | undefined =
        filter === "paid" ? { equals: "PAID" } : filter === "all" ? undefined : { in: ["EXPECTED", "PENDING", "OVERDUE"] };
      const commissions = await db.commission.findMany({
        where: {
          ...commissionOperationalWhere(scope.portfolioOwnerId),
          expectedDate: { gte: from, lte: businessEndOfDay(to) },
          ...(status ? { status } : {}),
        },
        select: {
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
        take: 1000,
      });
      return NextResponse.json({ success: true, report: {
        slug: "comisiones",
        title: "Comisiones",
        columns: ["Cliente", "Póliza", "Aseguradora", "Fecha esperada", "Fecha pagada", "Importe esperado", "Importe real", "Porcentaje", "Moneda", "Estado"],
        rows: commissions.map((commission) => ({
          Cliente: commission.client.fullName,
          "Póliza": commission.policy.policyNumber,
          Aseguradora: commission.insurer.name,
          "Fecha esperada": formatBusinessDateInput(commission.expectedDate),
          "Fecha pagada": commission.paidDate ? formatBusinessDateInput(commission.paidDate) : "",
          "Importe esperado": Number(commission.expectedAmount),
          "Importe real": commission.actualAmount == null ? "" : Number(commission.actualAmount),
          Porcentaje: commission.percentage == null ? "" : Number(commission.percentage),
          Moneda: commission.policy.currency,
          Estado: commission.status,
        })),
      }});
    }

    if (type === "operations") {
      const workItems = await getWorkItems({
        portfolioOwnerId: scope.portfolioOwnerId,
        from,
        to,
        statuses: filter === "all" ? undefined : OPEN_WORK_ITEM_STATUSES,
        priorities: filter === "urgent" ? ["URGENT"] : filter === "high" ? ["HIGH"] : undefined,
        limit: 1000,
      });
      return NextResponse.json({ success: true, report: {
        slug: "operacion",
        title: "Operación y pendientes",
        columns: ["Folio", "Pendiente", "Cliente", "Póliza", "Aseguradora", "Prioridad", "Estado", "Fecha límite"],
        rows: workItems.map((item) => ({
          Folio: item.folio ?? item.sourceId ?? item.id,
          Pendiente: item.title,
          Cliente: item.client?.fullName ?? "",
          "Póliza": item.policy?.policyNumber ?? "",
          Aseguradora: item.insurer?.name ?? "",
          Prioridad: item.priority,
          Estado: item.status,
          "Fecha límite": item.dueDate ? formatBusinessDateInput(item.dueDate) : "",
        })),
      }});
    }

    return NextResponse.json({ error: "El reporte solicitado no está soportado." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "No se pudo generar el reporte." }, { status: 500 });
  }
}
