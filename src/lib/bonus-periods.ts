import type { BonusProgram } from "@/lib/bonus-rules";

export type BonusPeriodOption = { value: number; label: string; description: string };

const quarterLabels = [
  { label: "T1 · ene-mar", description: "enero a marzo" },
  { label: "T2 · abr-jun", description: "abril a junio" },
  { label: "T3 · jul-sep", description: "julio a septiembre" },
  { label: "T4 · oct-dic", description: "octubre a diciembre" },
];

export function bonusPeriodOptions(program: Pick<BonusProgram, "period" | "accumulation">): BonusPeriodOption[] {
  if (program.period !== "QUARTERLY") {
    return [{ value: 1, label: "Anual · ene-dic", description: "el año calendario completo" }];
  }

  if (program.accumulation === "YEAR_TO_DATE") {
    return [
      { value: 1, label: "T1 · ene-mar", description: "enero a marzo" },
      { value: 2, label: "T2 · ene-jun", description: "enero a junio" },
      { value: 3, label: "T3 · ene-sep", description: "enero a septiembre" },
      { value: 4, label: "Cierre anual · ene-dic", description: "enero a diciembre" },
    ];
  }

  return quarterLabels.map((quarter, index) => ({
    value: index + 1,
    label: quarter.label,
    description: quarter.description,
  }));
}

export function bonusPeriodLabel(program: Pick<BonusProgram, "period" | "accumulation">, periodNumber: number) {
  return bonusPeriodOptions(program).find((period) => period.value === periodNumber)?.label ?? "Periodo anual";
}
