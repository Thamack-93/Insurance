"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { ChartEmptyState } from "@/components/charts/chart-empty";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ChartLegend } from "@/components/charts/chart-legend";
import { ChartPatternDefs, chartPattern } from "@/components/charts/chart-patterns";
import { ChartSrSummary } from "@/components/charts/chart-sr-summary";
import { chartTooltip } from "@/components/charts/chart-tooltip";
import {
  CHART_AXIS_PROPS,
  CHART_CURSOR_FILL,
  CHART_CURSOR_LINE,
  CHART_GRID_STROKE,
  chartSeriesColor,
} from "@/components/charts/chart-theme";

type ChartPoint = { name: string; value: number };

function sumValues(data: ChartPoint[]) {
  return data.reduce((sum, point) => sum + point.value, 0);
}

/**
 * Every chart keeps its screen-reader table outside the `role="img"` wrapper:
 * assistive tech does not expose the children of an image role, so a summary
 * nested inside it would never be announced. When there is nothing to plot the
 * shell steps aside entirely and shows the empty state as plain text, for the
 * same reason.
 */
function ChartShell({
  srTitle,
  srData,
  empty,
  imageLabel,
  children,
}: {
  srTitle: string;
  srData: ChartPoint[];
  empty: React.ReactNode;
  imageLabel: string;
  children: React.ReactNode;
}) {
  if (srData.length === 0) {
    return <div className="flex flex-1 flex-col">{empty}</div>;
  }

  return (
    <div className="flex flex-1 flex-col">
      <ChartSrSummary title={srTitle} data={srData} />
      <div className="flex flex-1 flex-col" role="img" aria-label={imageLabel}>
        {children}
      </div>
    </div>
  );
}

export function DuePaymentsChart({ data }: { data: ChartPoint[] }) {
  const total = sumValues(data);

  return (
    <ChartShell
      srTitle="Vencimientos por semana"
      srData={data}
      imageLabel="Gráfica de vencimientos por semana"
      empty={
        <ChartEmptyState message="No hay recibos por vencer en el periodo." hint="Los vencimientos aparecerán aquí en cuanto existan recibos abiertos." />
      }
    >
      <ChartFrame>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="dueGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
          <XAxis dataKey="name" {...CHART_AXIS_PROPS} />
          <YAxis allowDecimals={false} {...CHART_AXIS_PROPS} />
          <Tooltip
            cursor={CHART_CURSOR_LINE}
            content={chartTooltip({ total, valueLabel: "Recibos", shareLabel: "Proporción del total del periodo." })}
          />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" fill="url(#dueGradient)" strokeWidth={2} />
        </AreaChart>
      </ChartFrame>
    </ChartShell>
  );
}

export function RenewalsChart({ data }: { data: ChartPoint[] }) {
  const total = sumValues(data);

  return (
    <ChartShell
      srTitle="Renovaciones por semana"
      srData={data}
      imageLabel="Gráfica de renovaciones por semana"
      empty={
        <ChartEmptyState message="No hay renovaciones en el periodo." hint="Se graficarán las pólizas activas con vencimiento cercano." />
      }
    >
      <ChartFrame>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" {...CHART_AXIS_PROPS} />
          <YAxis allowDecimals={false} {...CHART_AXIS_PROPS} />
          <Tooltip
            cursor={CHART_CURSOR_FILL}
            content={chartTooltip({ total, valueLabel: "Renovaciones", shareLabel: "Proporción del total del periodo." })}
          />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--chart-2)" />
        </BarChart>
      </ChartFrame>
    </ChartShell>
  );
}

export function DistributionChart({ data }: { data: ChartPoint[] }) {
  const patternPrefix = useId().replace(/:/g, "");
  const normalized = data.map((item, index) => ({
    ...item,
    name: policyTypeLabel(item.name),
    color: chartSeriesColor(index),
    pattern: chartPattern(index),
    patternId: `${patternPrefix}-type-${index}`,
  }));
  const total = sumValues(normalized);

  return (
    <ChartShell
      srTitle="Distribución por tipo de póliza"
      srData={normalized}
      imageLabel={`Distribución de pólizas por tipo, total ${total}`}
      empty={
        <ChartEmptyState message="No hay pólizas para distribuir." hint="La composición de la cartera aparecerá al registrar pólizas." />
      }
    >
      <ChartFrame>
        <PieChart>
          <ChartPatternDefs
            items={normalized.map((item) => ({ id: item.patternId, color: item.color, pattern: item.pattern }))}
          />
          <Pie
            data={normalized}
            dataKey="value"
            nameKey="name"
            innerRadius="56%"
            outerRadius="84%"
            paddingAngle={3}
            stroke="var(--card)"
            strokeWidth={1}
          >
            {normalized.map((item) => (
              <Cell key={item.name} fill={`url(#${item.patternId})`} />
            ))}
          </Pie>
          <Tooltip
            content={chartTooltip({
              total,
              headingFromPayload: true,
              valueLabel: "Pólizas",
              shareLabel: "Proporción de la cartera graficada.",
            })}
          />
        </PieChart>
      </ChartFrame>
      <ChartLegend
        total={total}
        items={normalized.map((item) => ({
          key: item.name,
          label: item.name,
          value: item.value,
          color: item.color,
          pattern: item.pattern,
        }))}
      />
    </ChartShell>
  );
}

export function CommissionChart({ data }: { data: ChartPoint[] }) {
  const total = sumValues(data);

  return (
    <ChartShell
      srTitle="Comisiones por estado"
      srData={data}
      imageLabel="Gráfica de comisiones por mes"
      empty={
        <ChartEmptyState message="No hay comisiones esperadas por graficar." hint="Se mostrará el ingreso esperado por mes." />
      }
    >
      <ChartFrame>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis dataKey="name" {...CHART_AXIS_PROPS} />
          <YAxis {...CHART_AXIS_PROPS} width={72} tickFormatter={(value: number) => formatCurrency(value)} />
          <Tooltip
            cursor={CHART_CURSOR_FILL}
            content={chartTooltip({
              total,
              valueLabel: "Comisiones",
              formatValue: (value) => formatCurrency(value),
              shareLabel: "Proporción del total esperado.",
            })}
          />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--chart-3)" />
        </BarChart>
      </ChartFrame>
    </ChartShell>
  );
}
