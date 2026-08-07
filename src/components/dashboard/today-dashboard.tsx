"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, CircleDollarSign, ClipboardList, ReceiptText, RefreshCw, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TodayDashboardData } from "@/lib/dashboard-queries";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel, statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/badges/status-badge";
import { ChartSrSummary } from "@/components/charts/chart-sr-summary";

type DashboardMetrics = TodayDashboardData["metrics"];

const metricConfig: Record<keyof DashboardMetrics, { label: string; icon: LucideIcon; format: "number" | "currency" }> = {
  activePolicies: { label: "Pólizas vigentes", icon: ShieldCheck, format: "number" },
  renewals: { label: "Renovaciones próximas", icon: RefreshCw, format: "number" },
  pendingReceipts: { label: "Cobros pendientes", icon: ReceiptText, format: "currency" },
  commissions: { label: "Comisiones del mes", icon: CircleDollarSign, format: "currency" },
};

const statusColorMap: Record<string, string> = {
  ACTIVE: "var(--chart-2)",
  PENDING: "var(--chart-3)",
  EXPIRED: "var(--chart-4)",
  CANCELLED: "var(--chart-5)",
  RENEWED: "var(--chart-1)",
};

const alertToneStyles: Record<string, { icon: string; text: string }> = {
  warning: { icon: "bg-warning/10 text-warning", text: "text-warning" },
  critical: { icon: "bg-critical/10 text-critical", text: "text-critical" },
  information: { icon: "bg-information/10 text-information", text: "text-information" },
};

const alertIconMap: Record<string, LucideIcon> = {
  renewals: CalendarDays,
  overdue: ReceiptText,
  expired: ShieldAlert,
  tasks: ClipboardList,
};

function Sparkline({ data }: { data: number[] }) {
  const points = data.map((value, index) => ({ index, value }));
  return (
    <div className="h-9 w-24" aria-hidden>
      <ResponsiveContainer width="100%" height="100%" debounce={1}>
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={1.75} fill="url(#sparkGradient)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricCard({ metricKey, data, prevMonthLabel }: { metricKey: keyof DashboardMetrics; data: DashboardMetrics[keyof DashboardMetrics]; prevMonthLabel: string }) {
  const config = metricConfig[metricKey];
  const Icon = config.icon;
  const positive = data.delta >= 0;
  const DeltaIcon = positive ? ArrowUpRight : ArrowDownRight;
  const formatted = config.format === "currency" ? formatCurrency(data.value, "MXN") : data.value.toLocaleString("es-MX");

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{config.label}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground" aria-hidden>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-1 text-[26px] font-semibold tracking-tight text-foreground">{formatted}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className={cn("flex items-center gap-0.5 text-xs font-medium", positive ? "text-success" : "text-critical")}>
          <DeltaIcon className="size-3.5" aria-hidden />
          {Math.abs(data.delta)}%
          <span className="font-normal text-muted-foreground">vs. {prevMonthLabel}</span>
        </p>
        <Sparkline data={data.spark} />
      </div>
    </div>
  );
}

export function TodayMetricCards({ metrics, prevMonthLabel }: { metrics: DashboardMetrics; prevMonthLabel: string }) {
  return (
    <section aria-label="Métricas del mes" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {(Object.keys(metricConfig) as Array<keyof DashboardMetrics>).map((key) => (
        <MetricCard key={key} metricKey={key} data={metrics[key]} prevMonthLabel={prevMonthLabel} />
      ))}
    </section>
  );
}

export function PolicyActivityChart({ data }: { data: TodayDashboardData["activity"] }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="policy-activity-title">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 id="policy-activity-title" className="text-sm font-semibold">Actividad de pólizas</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Últimos 6 meses</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-1)" }} aria-hidden />Emitidas</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-2)" }} aria-hidden />Recibos</span>
        </div>
      </div>
      <div role="img" aria-label="Gráfica de líneas de actividad de pólizas y recibos de los últimos 6 meses">
        <ChartSrSummary title="Pólizas emitidas por mes" data={data.map((point) => ({ name: point.name, value: point.pólizas }))} />
        <ChartSrSummary title="Recibos generados por mes" data={data.map((point) => ({ name: point.name, value: point.recibos }))} />
        <ResponsiveContainer width="100%" height={260} debounce={1}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
            <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="pólizas" stroke="var(--chart-1)" strokeWidth={2.25} dot={{ r: 3 }} name="Emitidas" />
            <Line type="monotone" dataKey="recibos" stroke="var(--chart-2)" strokeWidth={2.25} dot={{ r: 3 }} name="Recibos" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function PolicyStatusDonut({ data }: { data: TodayDashboardData["statusDistribution"] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    label: statusLabel(item.status, "policy"),
    fill: statusColorMap[item.status] ?? `var(--chart-${(index % 5) + 1})`,
  }));

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="policy-status-title">
      <h2 id="policy-status-title" className="text-sm font-semibold">Estado de pólizas</h2>
      <div className="relative" role="img" aria-label={`Distribución de pólizas por estado, total ${total}`}>
        <ResponsiveContainer width="100%" height={200} debounce={1}>
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={3} strokeWidth={0}>
              {chartData.map((item) => (
                <Cell key={item.status} fill={item.fill} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight">{total.toLocaleString("es-MX")}</span>
          <span className="text-xs text-muted-foreground">Total</span>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
        {chartData.map((item) => (
          <li key={item.status} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: item.fill }} aria-hidden />
              {item.label}
            </span>
            <span className="font-medium text-foreground">
              {item.value.toLocaleString("es-MX")}
              <span className="ml-1 text-muted-foreground">({total ? Math.round((item.value / total) * 100) : 0}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AlertsPanel({ alerts }: { alerts: TodayDashboardData["alerts"] }) {
  return (
    <section className="rounded-xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="alerts-title">
      <div className="border-b px-4 py-4">
        <h2 id="alerts-title" className="text-sm font-semibold">Alertas y tareas</h2>
      </div>
      <div>
        {alerts.map((alert) => {
          const Icon = alertIconMap[alert.id] ?? ClipboardList;
          const tone = alertToneStyles[alert.tone] ?? alertToneStyles.information;
          return (
            <Link
              key={alert.id}
              href={alert.href}
              className="flex items-center justify-between gap-3 border-b px-4 py-3.5 last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", tone.icon)} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{alert.label}</span>
                  <span className="block text-xs text-muted-foreground">{alert.detail}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={cn("rounded-full bg-muted px-2 py-0.5 text-xs font-semibold", tone.text)}>{alert.count}</span>
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function RecentPoliciesTable({ policies }: { policies: TodayDashboardData["recentPolicies"] }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="recent-policies-title">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-4">
        <h2 id="recent-policies-title" className="text-sm font-semibold">Pólizas recientes</h2>
        <Link href="/policies" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Ver todas las pólizas
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="border-b">
              <th className="h-10 px-4 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Póliza</th>
              <th className="h-10 px-2 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Cliente</th>
              <th className="hidden h-10 px-2 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground md:table-cell">Ramo</th>
              <th className="hidden h-10 px-2 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:table-cell">Vigencia</th>
              <th className="h-10 px-2 text-right align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Prima</th>
              <th className="h-10 px-4 text-left align-middle text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Estado</th>
            </tr>
          </thead>
          <tbody>
            {policies.length ? (
              policies.map((policy) => (
                <tr key={policy.id} className="border-b last:border-b-0 hover:bg-muted/50">
                  <td className="px-4 py-3 align-middle">
                    <Link href={`/policies/${policy.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {policy.policyNumber}
                    </Link>
                  </td>
                  <td className="max-w-[180px] truncate px-2 py-3 align-middle">{policy.clientName}</td>
                  <td className="hidden px-2 py-3 align-middle text-muted-foreground md:table-cell">{policyTypeLabel(policy.policyType)}</td>
                  <td className="hidden px-2 py-3 align-middle whitespace-nowrap text-muted-foreground lg:table-cell">
                    {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
                  </td>
                  <td className="px-2 py-3 text-right align-middle font-medium whitespace-nowrap">{formatCurrency(policy.premiumAmount, policy.currency)}</td>
                  <td className="px-4 py-3 align-middle"><StatusBadge status={policy.status} entity="policy" /></td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Aún no hay pólizas registradas.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
