import { describe, expect, it } from "vitest";
import { bucketCommissionsByMonth, bucketDatesByMonth, MONTHLY_COMMISSION_STATUSES, pctChange } from "@/lib/dashboard.logic";

describe("MONTHLY_COMMISSION_STATUSES", () => {
  it("incluye comisiones pagadas, esperadas, pendientes y vencidas", () => {
    expect(MONTHLY_COMMISSION_STATUSES).toEqual(
      expect.arrayContaining(["PAID", "EXPECTED", "PENDING", "OVERDUE"]),
    );
  });
});

describe("pctChange", () => {
  it("calcula el cambio porcentual con un decimal", () => {
    expect(pctChange(113, 100)).toBe(13);
    expect(pctChange(90, 120)).toBe(-25);
  });

  it("devuelve 100 cuando no había valor previo y ahora sí hay", () => {
    expect(pctChange(50, 0)).toBe(100);
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe("bucketCommissionsByMonth", () => {
  const months = ["2026-06", "2026-07", "2026-08"];

  it("suma comisiones pagadas y esperadas en su mes", () => {
    const rows = [
      { expectedDate: new Date("2026-08-10T12:00:00"), expectedAmount: 100, actualAmount: null },
      { expectedDate: new Date("2026-08-15T12:00:00"), expectedAmount: 80, actualAmount: 95 }, // PAID con monto real
      { expectedDate: new Date("2026-07-05T12:00:00"), expectedAmount: 40, actualAmount: null },
    ];
    expect(bucketCommissionsByMonth(rows, months)).toEqual([0, 40, 195]);
  });

  it("ignora comisiones fuera del rango de meses", () => {
    const rows = [{ expectedDate: new Date("2025-12-01T12:00:00"), expectedAmount: 500, actualAmount: null }];
    expect(bucketCommissionsByMonth(rows, months)).toEqual([0, 0, 0]);
  });
});

describe("bucketDatesByMonth", () => {
  const months = ["2026-06", "2026-07", "2026-08"];

  it("separa la fecha de negocio de la fecha de captura", () => {
    const businessDate = new Date("2026-06-15T12:00:00");
    const capturedDate = new Date("2026-07-20T12:00:00");

    expect(bucketDatesByMonth([businessDate], months)).toEqual([1, 0, 0]);
    expect(bucketDatesByMonth([capturedDate], months)).toEqual([0, 1, 0]);
  });

  it("ignora fechas fuera del rango y conserva meses sin actividad", () => {
    expect(bucketDatesByMonth([new Date("2025-12-01T12:00:00"), new Date("2026-08-31T12:00:00")], months)).toEqual([0, 0, 1]);
  });

  it("usa la zona horaria de negocio en los límites de mes", () => {
    expect(bucketDatesByMonth([new Date("2026-07-01T05:59:59.000Z"), new Date("2026-07-01T06:00:00.000Z")], months)).toEqual([1, 1, 0]);
  });
});
