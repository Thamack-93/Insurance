"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { generateCommissionReport } from "@/app/(dashboard)/commissions/actions";
import { getCommissionPeriodRange, type CommissionPeriodPreset } from "@/lib/commissions-periods";

type Preset = CommissionPeriodPreset | "CUSTOM";

const presets: Array<{ value: Preset; label: string }> = [
  { value: "PREVIOUS_MONTH", label: "Mes pasado" },
  { value: "CURRENT_MONTH", label: "Mes actual" },
  { value: "CURRENT_YEAR", label: "Año actual" },
  { value: "CUSTOM", label: "Rango personalizado" },
];

function activePreset(anchor: string, from: string, to: string): Preset {
  for (const value of ["PREVIOUS_MONTH", "CURRENT_MONTH", "CURRENT_YEAR"] as const) {
    const range = getCommissionPeriodRange(anchor, value);
    if (range.from === from && range.to === to) return value;
  }
  return "CUSTOM";
}

export function CommissionPeriodFilter({
  anchor,
  initialFrom,
  initialTo,
}: {
  anchor: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [selected, setSelected] = useState<Preset>(() => activePreset(anchor, initialFrom, initialTo));

  function choosePreset(preset: Preset) {
    setSelected(preset);
    if (preset === "CUSTOM") return;
    const range = getCommissionPeriodRange(anchor, preset);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <form action={generateCommissionReport} className="grid gap-3 border-b px-4 py-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm font-medium">Periodo</legend>
        {presets.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={selected === value ? "default" : "outline"}
            aria-pressed={selected === value}
            onClick={() => choosePreset(value)}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">Desde<input required type="date" name="paidFrom" value={from} onChange={(event) => { setFrom(event.target.value); setSelected("CUSTOM"); }} className="h-10 rounded-md border bg-background px-3" /></label>
        <label className="grid gap-1 text-sm">Hasta<input required type="date" name="paidTo" value={to} onChange={(event) => { setTo(event.target.value); setSelected("CUSTOM"); }} className="h-10 rounded-md border bg-background px-3" /></label>
        <Button type="submit">Calcular y generar reporte</Button>
      </div>
    </form>
  );
}
