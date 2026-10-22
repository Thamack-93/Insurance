"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { bonusPeriodOptions } from "@/lib/bonus-periods";
import { previewBonus } from "./actions";

type ProgramOption = {
  key: string;
  label: string;
  period: "QUARTERLY" | "ANNUAL" | "FIRST_YEAR" | "ELIGIBILITY";
  accumulation: "YEAR_TO_DATE" | "QUARTER" | "YEAR" | "FIRST_POLICY_YEAR";
};

type SellerOption = { id: string; name: string; email: string };

export function BonusProjectionForm({
  programs,
  sellers,
  initialProgramKey,
  initialSellerId,
  initialPeriodNumber,
  initialLossRatio,
}: {
  programs: ProgramOption[];
  sellers: SellerOption[];
  initialProgramKey: string;
  initialSellerId: string;
  initialPeriodNumber: number;
  initialLossRatio: string;
}) {
  const [programKey, setProgramKey] = useState(initialProgramKey);
  const [periodNumber, setPeriodNumber] = useState(initialPeriodNumber);
  const program = programs.find((option) => option.key === programKey) ?? programs[0];
  if (!program) return <p className="text-sm text-muted-foreground">No hay programas de bono disponibles.</p>;
  const periods = bonusPeriodOptions(program);
  const selectedPeriod = periods.find((period) => period.value === periodNumber) ?? periods[0];
  const isDamageProgram = program.key.startsWith("DAMAGE_");
  const periodHint = program.period === "QUARTERLY" && program.accumulation === "YEAR_TO_DATE"
    ? "Autos acumula la prima desde enero hasta el corte. El cierre anual corresponde a T4."
    : program.period === "QUARTERLY"
      ? "Daños suma únicamente la prima pagada dentro del trimestre seleccionado."
      : "Se considera la prima elegible pagada durante el año calendario completo.";

  return (
    <form action={previewBonus} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Programa</span>
        <select
          name="programKey"
          value={programKey}
          onChange={(event) => {
            const nextProgram = programs.find((option) => option.key === event.currentTarget.value);
            if (!nextProgram) return;
            setProgramKey(nextProgram.key);
            setPeriodNumber(bonusPeriodOptions(nextProgram)[0].value);
          }}
          className="h-10 rounded-md border bg-background px-3"
        >
          {programs.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Vendedor</span>
        <select required name="sellerId" defaultValue={initialSellerId} className="h-10 rounded-md border bg-background px-3">
          {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} · {seller.email}</option>)}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Año</span>
        <select name="year" defaultValue="2026" className="h-10 rounded-md border bg-background px-3"><option value="2026">2026</option></select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Periodo</span>
        <select name="periodNumber" value={selectedPeriod.value} onChange={(event) => setPeriodNumber(Number(event.currentTarget.value))} className="h-10 rounded-md border bg-background px-3">
          {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{selectedPeriod.description} de 2026.</span>
      </label>

      {isDamageProgram ? (
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Siniestralidad total de cartera Daños (%)</span>
          <input name="damagePortfolioLossRatio" type="number" min="0" max="100" step="0.00000001" placeholder="Captura el dato del cierre de Daños" defaultValue={initialLossRatio} className="h-10 rounded-md border bg-background px-3" />
          <span className="text-xs text-muted-foreground">Usa la cartera total del vendedor, todas las aseguradoras. Con 50% o más, el bono se excluye.</span>
        </label>
      ) : null}

      <div className="flex items-end sm:col-span-2 xl:col-span-1">
        <Button type="submit" disabled={!sellers.length} className="w-full sm:w-auto">Calcular proyección</Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2 xl:col-span-3">{periodHint} Solo se consideran pagos POSTED; los revertidos quedan fuera. Los datos o evidencias faltantes dejan el cálculo pendiente de revisión.</p>
    </form>
  );
}
