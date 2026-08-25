"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronRight, CircleDollarSign, ClipboardList, ReceiptText, RefreshCw, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TodayDashboardData } from "@/lib/dashboard-queries";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel, statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { ChartEmptyState } from "@/components/charts/chart-empty";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ChartLegend } from "@/components/charts/chart-legend";
import { ChartPatternDefs, chartPattern } from "@/components/charts/chart-patterns";
import { ChartSrSummary } from "@/components/charts/chart-sr-summary";
import { chartTooltip } from "@/components/charts/chart-tooltip";
import { CHART_AXIS_PROPS, CHART_CURSOR_LINE, CHART_GRID_STROKE, chartSeriesColor } from "@/components/charts/chart-theme";

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
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }} debounce={1}>
        <AreaChart accessibilityLayer={false} data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
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

type ActivityMode = "business" | "capture";

const activityModeCopy: Record<ActivityMode, {
  label: string;
  subtitle: string;
  policyLabel: string;
  receiptLabel: string;
  note: string;
  shareLabel: string;
}> = {
  business: {
    label: "Actividad real",
    subtitle: "Últimos 6 meses · fechas del negocio",
    policyLabel: "Inicios de vigencia",
    receiptLabel: "Recibos por periodo",
    note: "Usa el inicio de vigencia de las pólizas y el inicio del periodo de cada recibo.",
    shareLabel: "Proporción de la actividad real de los últimos 6 meses.",
  },
  capture: {
    label: "Captura en sistema",
    subtitle: "Últimos 6 meses · registros en PolicyDesk",
    policyLabel: "Pólizas registradas",
    receiptLabel: "Recibos registrados",
    note: "Incluye cargas masivas históricas; julio puede reflejar el momento de importación.",
    shareLabel: "Proporción de los registros en sistema de los últimos 6 meses.",
  },
};

export function PolicyActivityChart({ data, captureData }: { data: TodayDashboardData["activity"]; captureData: TodayDashboardData["captureActivity"] }) {
  const [mode, setMode] = useState<ActivityMode>("business");
  const selectedData = mode === "business" ? data : captureData;
  const copy = activityModeCopy[mode];
  const policiesSeries = selectedData.map((point) => ({ name: point.name, value: point.pólizas }));
  const receiptsSeries = selectedData.map((point) => ({ name: point.name, value: point.recibos }));
  const seriesTotals = {
    "pólizas": policiesSeries.reduce((sum, point) => sum + point.value, 0),
    recibos: receiptsSeries.reduce((sum, point) => sum + point.value, 0),
  };
  const hasData = selectedData.some((point) => point.pólizas > 0 || point.recibos > 0);

  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="policy-activity-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="policy-activity-title" className="text-sm font-semibold">Actividad de pólizas</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="inline-flex items-center rounded-md border bg-background p-1 shadow-sm" role="group" aria-label="Base de la gráfica">
          {(Object.keys(activityModeCopy) as ActivityMode[]).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={mode === option ? "default" : "ghost"}
              className={cn("h-7 rounded-md px-2.5 text-xs", mode === option ? "shadow-sm" : "text-muted-foreground")}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {activityModeCopy[option].label}
            </Button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: "var(--chart-1)" }} aria-hidden />{copy.policyLabel}</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--chart-2)" }} aria-hidden />{copy.receiptLabel}</span>
        <span className="basis-full text-[11px] sm:basis-auto">{copy.note}</span>
      </div>
      {hasData ? (
        <>
          {/* The screen-reader tables stay outside role="img": assistive tech
              does not expose the contents of an image role. */}
          <ChartSrSummary title={`${copy.policyLabel} por mes`} data={policiesSeries} />
          <ChartSrSummary title={`${copy.receiptLabel} por mes`} data={receiptsSeries} />
          <div className="flex flex-1 flex-col" role="img" aria-label={`Gráfica de líneas de ${copy.label.toLowerCase()} de pólizas y recibos de los últimos 6 meses`}>
            <ChartFrame>
              <LineChart data={selectedData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="name" {...CHART_AXIS_PROPS} />
                <YAxis allowDecimals={false} {...CHART_AXIS_PROPS} />
                <Tooltip
                  cursor={CHART_CURSOR_LINE}
                  content={chartTooltip({ total: seriesTotals, shareLabel: copy.shareLabel })}
                />
                <Line type="monotone" dataKey="pólizas" stroke="var(--chart-1)" strokeWidth={2.25} dot={{ r: 3 }} name={copy.policyLabel} />
                <Line type="monotone" dataKey="recibos" stroke="var(--chart-2)" strokeWidth={2.25} strokeDasharray="5 3" dot={{ r: 3 }} name={copy.receiptLabel} />
              </LineChart>
            </ChartFrame>
          </div>
        </>
      ) : (
        <ChartEmptyState message={`Todavía no hay ${copy.label.toLowerCase()} en los últimos 6 meses.`} hint={`Aquí verás ${copy.policyLabel.toLowerCase()} y ${copy.receiptLabel.toLowerCase()} por mes.`} />
      )}
    </section>
  );
}

export function PolicyStatusDonut({ data }: { data: TodayDashboardData["statusDistribution"] }) {
  const patternPrefix = useId().replace(/:/g, "");
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const chartData = data.map((item, index) => ({
    ...item,
    label: statusLabel(item.status, "policy"),
    color: statusColorMap[item.status] ?? chartSeriesColor(index),
    pattern: chartPattern(index),
    patternId: `${patternPrefix}-status-${index}`,
  }));

  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]" aria-labelledby="policy-status-title">
      <h2 id="policy-status-title" className="text-sm font-semibold">Estado de pólizas</h2>
      <ChartSrSummary
        title="Pólizas por estado"
        data={chartData.map((item) => ({ name: item.label, value: item.value }))}
      />
      {total > 0 ? (
        <>
          <div className="relative flex flex-1 flex-col" role="img" aria-label={`Distribución de pólizas por estado, total ${total}`}>
            <ChartFrame className="min-h-40">
              <PieChart>
                <ChartPatternDefs
                  items={chartData.map((item) => ({ id: item.patternId, color: item.color, pattern: item.pattern }))}
                />
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="60%"
                  outerRadius="86%"
                  paddingAngle={3}
                  stroke="var(--card)"
                  strokeWidth={1}
                >
                  {chartData.map((item) => (
                    <Cell key={item.status} fill={`url(#${item.patternId})`} />
                  ))}
                </Pie>
                <Tooltip
                  content={chartTooltip({
                    total,
                    headingFromPayload: true,
                    valueLabel: "Pólizas",
                    shareLabel: "Proporción de la cartera.",
                  })}
                />
              </PieChart>
            </ChartFrame>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tracking-tight">{total.toLocaleString("es-MX")}</span>
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
          </div>
          <ChartLegend
            total={total}
            items={chartData.map((item) => ({
              key: item.status,
              label: item.label,
              value: item.value,
              color: item.color,
              pattern: item.pattern,
            }))}
          />
        </>
      ) : (
        <ChartEmptyState
          className="mt-3"
          message="Aún no hay pólizas en cartera."
          hint="El estado de las pólizas se graficará al registrar la primera."
        />
      )}
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
