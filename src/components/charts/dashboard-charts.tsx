"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { policyTypeLabel } from "@/lib/status";
import { ChartSrSummary } from "@/components/charts/chart-sr-summary";

type ChartPoint = { name: string; value: number };

const CHART_HEIGHT = 256;
const colors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];
const GRID_STROKE = "var(--border)";

export function DuePaymentsChart({ data }: { data: ChartPoint[] }) {
  return (
    <div role="img" aria-label="Gráfica de vencimientos por semana">
      <ChartSrSummary title="Vencimientos por semana" data={data} />
    <ResponsiveContainer width="100%" height={CHART_HEIGHT} debounce={1}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="dueGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} />
        <Tooltip />
        <Area type="monotone" dataKey="value" stroke="var(--chart-1)" fill="url(#dueGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}

export function RenewalsChart({ data }: { data: ChartPoint[] }) {
  return (
    <div role="img" aria-label="Gráfica de renovaciones por semana">
      <ChartSrSummary title="Renovaciones por semana" data={data} />
    <ResponsiveContainer width="100%" height={CHART_HEIGHT} debounce={1}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} />
        <Tooltip />
        <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--chart-2)" />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({ data }: { data: ChartPoint[] }) {
  const normalized = data.map((item) => ({ ...item, name: policyTypeLabel(item.name) }));
  return (
    <div role="img" aria-label="Distribución de pólizas por tipo">
      <ChartSrSummary title="Distribución por tipo de póliza" data={normalized} />
    <ResponsiveContainer width="100%" height={CHART_HEIGHT} debounce={1}>
      <PieChart>
        <Pie data={normalized} dataKey="value" nameKey="name" innerRadius={54} outerRadius={86} paddingAngle={3}>
          {normalized.map((item, index) => (
            <Cell key={item.name} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
    </div>
  );
}

export function CommissionChart({ data }: { data: ChartPoint[] }) {
  return (
    <div role="img" aria-label="Gráfica de comisiones por estado">
      <ChartSrSummary title="Comisiones por estado" data={data} />
    <ResponsiveContainer width="100%" height={CHART_HEIGHT} debounce={1}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} />
        <Tooltip />
        <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--chart-3)" />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
