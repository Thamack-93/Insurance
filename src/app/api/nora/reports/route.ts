import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { businessAddDays, businessToday, formatBusinessDateInput } from "@/lib/business-dates";
import { getDb } from "@/lib/db";
import { policyOperationalWhere, receiptOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const scope = await requirePortfolioReadScope();
    const db = getDb();
    const type = request.nextUrl.searchParams.get("type");
    const today = businessToday();

    if (type === "overdue") {
      const receipts = await db.receipt.findMany({
        where: {
          ...receiptOperationalWhere(scope.portfolioOwnerId),
          dueDate: { lt: today },
          status: { notIn: ["PAID", "CANCELLED"] },
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
          title: "Cobranza vencida a la fecha",
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
      const policies = await db.policy.findMany({
        where: {
          ...policyOperationalWhere(scope.portfolioOwnerId),
          status: "ACTIVE",
          endDate: { gte: today, lte: businessAddDays(today, days) },
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
          title: `Renovaciones próximas · ${days} días`,
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
      const policies = await db.policy.findMany({
        where: { ...policyOperationalWhere(scope.portfolioOwnerId), status: "ACTIVE" },
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

    return NextResponse.json({ error: "El reporte solicitado no está soportado." }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "No se pudo generar el reporte." }, { status: 500 });
  }
}
