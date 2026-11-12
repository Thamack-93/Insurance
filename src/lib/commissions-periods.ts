export type CommissionPeriodPreset = "PREVIOUS_MONTH" | "CURRENT_MONTH" | "CURRENT_YEAR";

export type CommissionPeriodRange = { from: string; to: string };

function dateInput(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getCommissionPeriodRange(anchor: string, preset: CommissionPeriodPreset): CommissionPeriodRange {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor);
  if (!match) throw new Error("La fecha base debe tener formato YYYY-MM-DD.");
  const [, yearText, monthText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  if (month < 1 || month > 12) throw new Error("La fecha base no es válida.");

  if (preset === "CURRENT_YEAR") return { from: dateInput(year, 1, 1), to: dateInput(year, 12, 31) };
  if (preset === "CURRENT_MONTH") {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: dateInput(year, month, 1), to: dateInput(year, month, lastDay) };
  }

  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previousMonth.getUTCFullYear();
  const previousMonthNumber = previousMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(previousYear, previousMonthNumber, 0)).getUTCDate();
  return {
    from: dateInput(previousYear, previousMonthNumber, 1),
    to: dateInput(previousYear, previousMonthNumber, lastDay),
  };
}
