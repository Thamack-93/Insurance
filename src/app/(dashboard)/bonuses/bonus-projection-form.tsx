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
  initialLossRatioAsOf,
  initialLossRatioSource,
  demoMode,
  demoLossRatioAsOf,
}: {
  programs: ProgramOption[];
  sellers: SellerOption[];
  initialProgramKey: string;
  initialSellerId: string;
  initialPeriodNumber: number;
  initialLossRatio: string;
  initialLossRatioAsOf: string;
  initialLossRatioSource: string;
  demoMode: boolean;
  demoLossRatioAsOf: string;
}) {
  const [programKey, setProgramKey] = useState(initialProgramKey);
  const [periodNumber, setPeriodNumber] = useState(initialPeriodNumber);
  const program = programs.find((option) => option.key === programKey) ?? programs[0];
  if (!program) return <p className="text-sm text-muted-foreground">No hay programas de bono disponibles.</p>;
  const periods = bonusPeriodOptions(program);
  const selectedPeriod = periods.find((period) => period.value === periodNumber) ?? periods[0];
  const isDamageProgram = program.key.startsWith("DAMAGE_");
  const defaultLossRatio = demoMode ? "30" : "";
  const defaultLossRatioAsOf = demoMode ? demoLossRatioAsOf : "";
  const defaultLossRatioSource = demoMode ? "Dato sintético DEMO para probar la proyección; no usar en cierres reales." : "";
  const periodHint = program.period === "QUARTERLY" && program.accumulation === "YEAR_TO_DATE"
    ? "Autos acumula la prima desde enero hasta el corte. El cierre anual corresponde a T4."
    : program.period === "QUARTERLY"
      ? "Daños suma únicamente la prima pagada dentro del trimestre seleccionado."
      : "Se considera la prima elegible pagada durante el año calendario completo.";

  return (
    <form action={previewBonus} className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
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
          className="h-11 min-w-0 rounded-md border bg-background px-3"
        >
          {programs.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Vendedor</span>
        <select required name="sellerId" defaultValue={initialSellerId} className="h-11 min-w-0 rounded-md border bg-background px-3">
          {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name} · {seller.email}</option>)}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Año</span>
        <select name="year" defaultValue="2026" className="h-11 min-w-0 rounded-md border bg-background px-3"><option value="2026">2026</option></select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Periodo</span>
        <select name="periodNumber" value={selectedPeriod.value} onChange={(event) => setPeriodNumber(Number(event.currentTarget.value))} aria-describedby="bonus-period-description" className="h-11 min-w-0 rounded-md border bg-background px-3">
          {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
        </select>
        <span id="bonus-period-description" className="text-xs leading-relaxed text-muted-foreground">{selectedPeriod.description} de 2026.</span>
      </label>

      {isDamageProgram ? (
        <div className="grid gap-4 sm:col-span-2 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Siniestralidad total de cartera Daños (%)</span>
              <input name="damagePortfolioLossRatio" type="number" min="0" max="100" step="0.00000001" placeholder="Captura el dato del cierre de Daños" defaultValue={initialLossRatio || defaultLossRatio} aria-describedby="bonus-loss-ratio-description" className="h-11 min-w-0 rounded-md border bg-background px-3" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Fecha de corte</span>
              <input name="damagePortfolioLossRatioAsOf" type="date" defaultValue={initialLossRatioAsOf || defaultLossRatioAsOf} className="h-11 min-w-0 rounded-md border bg-background px-3" />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Fuente o referencia del dato</span>
            <input name="damagePortfolioLossRatioSource" type="text" maxLength={500} placeholder="Reporte de siniestralidad de la cartera total" defaultValue={initialLossRatioSource || (demoMode ? defaultLossRatioSource : "")} className="h-11 min-w-0 rounded-md border bg-background px-3" />
          </label>
          <span id="bonus-loss-ratio-description" className="text-xs leading-relaxed text-muted-foreground">Usa la cartera total del vendedor, todas las aseguradoras. Con 50% o más, el bono se excluye. Si falta el porcentaje, fecha o fuente, el cierre queda pendiente de revisión.</span>
          {demoMode ? <span className="text-xs text-amber-700 dark:text-amber-300">Valores sintéticos precargados para probar una DEMO. Sustitúyelos por evidencia real antes de usar un cierre fuera de pruebas.</span> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between xl:col-span-4">
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{periodHint} Solo se consideran pagos POSTED; los revertidos quedan fuera. Los datos o evidencias faltantes dejan el cálculo pendiente de revisión.</p>
        <Button type="submit" disabled={!sellers.length} className="w-full shrink-0 sm:w-auto">Calcular proyección</Button>
      </div>
    </form>
  );
}
