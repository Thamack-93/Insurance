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

type ChartPoint = { name: string; value: number };

const colors = ["#256f87", "#2f9e75", "#d19018", "#c84d3f", "#6f5aa8", "#64748b"];

export function DuePaymentsChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="dueGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#256f87" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#256f87" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e0d4" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip />
          <Area type="monotone" dataKey="value" stroke="#256f87" fill="url(#dueGradient)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RenewalsChart({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#2f9e75" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionChart({ data }: { data: ChartPoint[] }) {
  const normalized = data.map((item) => ({ ...item, name: policyTypeLabel(item.name) }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
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
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#d19018" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

