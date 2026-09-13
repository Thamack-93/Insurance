import type { Prisma } from "@/generated/prisma/client";
import { businessAddDays, businessStartOfDay } from "@/lib/business-dates";

export type KpiDateWindow = "30d" | "60d" | "90d";
export type KpiDefinition = {
  key: string;
  label: string;
  window?: KpiDateWindow;
  denominator: string;
  aggregation: "COUNT" | "SUM";
};

export const KPI_DICTIONARY: readonly KpiDefinition[] = [
  { key: "active_policies", label: "Pólizas activas", denominator: "ACTIVE policies", aggregation: "COUNT" },
  { key: "open_receipts", label: "Recibos abiertos", denominator: "PENDING or OVERDUE receipts", aggregation: "COUNT" },
  { key: "renewals_30", label: "Renovaciones a 30 días", window: "30d", denominator: "eligible renewals", aggregation: "COUNT" },
  { key: "renewals_60", label: "Renovaciones a 60 días", window: "60d", denominator: "eligible renewals", aggregation: "COUNT" },
  { key: "renewals_90", label: "Renovaciones a 90 días", window: "90d", denominator: "eligible renewals", aggregation: "COUNT" },
  { key: "open_receipt_amount", label: "Monto abierto", denominator: "PENDING or OVERDUE receipts", aggregation: "SUM" },
] as const;

export function kpiWindowBounds(window: KpiDateWindow, now = new Date()) {
  const from = businessStartOfDay(now);
  const days = Number(window.slice(0, -1));
  return { from, to: businessAddDays(from, days) };
}

export function openReceiptWhere(organizationId: string, portfolioOwnerId?: string): Prisma.ReceiptWhereInput {
  return {
    organizationId,
    status: { in: ["PENDING", "OVERDUE"] },
    ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
  };
}

export function kpiDestination(key: string, filters: { portfolioId?: string; window?: KpiDateWindow } = {}) {
  const params = new URLSearchParams();
  if (filters.portfolioId) params.set("portfolio", filters.portfolioId);
  if (filters.window) params.set("window", filters.window);
  const suffix = params.toString();
  if (key.startsWith("renewals_")) return `/operations?view=renewals${suffix ? `&${suffix}` : ""}`;
  if (key.startsWith("open_receipt")) return `/receipts?tab=cobrar${suffix ? `&${suffix}` : ""}`;
  return `/policies${suffix ? `?${suffix}` : ""}`;
}
