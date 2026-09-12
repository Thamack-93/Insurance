import { describe, expect, it } from "vitest";
import {
  buildRenewalFollowUpMessage,
  businessWeekKey,
  canScheduleRenewalManualFollowUp,
  DEFAULT_RENEWAL_BOARD_WINDOW,
  getRenewalStallState,
  readRenewalBoardFilters,
  renewalFollowUpDedupeKey,
  renewalFollowUpShortcutDate,
  renewalFollowUpWorkItemSourceId,
  renewalManualFollowUpWorkItemSourceId,
  RENEWAL_FOLLOWUP_SOURCE_SUFFIX,
  renewalWindowRange,
  resolveRenewalStage,
} from "./renewal-board.logic";
import { getBusinessDateKey, parseBusinessDateInput } from "./business-dates";

const today = parseBusinessDateInput("2026-08-07");

describe("renewal-board.logic — columna de la tarjeta", () => {
  it("usa la etapa guardada mientras no haya un desenlace real", () => {
    expect(
      resolveRenewalStage({ policyStatus: "ACTIVE", renewalStage: "CONTACTED", hasDeclinedSuggestion: false }),
    ).toBe("CONTACTED");
    expect(
      resolveRenewalStage({ policyStatus: "ACTIVE", renewalStage: "QUOTED", hasDeclinedSuggestion: false }),
    ).toBe("QUOTED");
  });

  it("cae en PENDING cuando la etapa está vacía o es desconocida", () => {
    expect(resolveRenewalStage({ policyStatus: "ACTIVE", renewalStage: null, hasDeclinedSuggestion: false })).toBe(
      "PENDING",
    );
    expect(
      resolveRenewalStage({ policyStatus: "ACTIVE", renewalStage: "MISTERIO", hasDeclinedSuggestion: false }),
    ).toBe("PENDING");
  });

  it("respeta el alta de renovación existente por encima de la etapa manual", () => {
    expect(
      resolveRenewalStage({ policyStatus: "RENEWED", renewalStage: "CONTACTED", hasDeclinedSuggestion: false }),
    ).toBe("WON");
    // Una sugerencia rechazada vieja no puede tapar una renovación que sí ocurrió.
    expect(
      resolveRenewalStage({ policyStatus: "RENEWED", renewalStage: "PENDING", hasDeclinedSuggestion: true }),
    ).toBe("WON");
  });

  it("manda a Perdido lo que pasó por el flujo de 'No renueva'", () => {
    expect(
      resolveRenewalStage({ policyStatus: "ACTIVE", renewalStage: "PENDING", hasDeclinedSuggestion: true }),
    ).toBe("LOST");
  });
});

describe("renewal-board.logic — filtros de la URL", () => {
  it("aplica la ventana por defecto y acepta sólo las conocidas", () => {
    expect(readRenewalBoardFilters({}).window).toBe(DEFAULT_RENEWAL_BOARD_WINDOW);
    expect(readRenewalBoardFilters({ window: "30" }).window).toBe("30");
    expect(readRenewalBoardFilters({ window: "999" }).window).toBe(DEFAULT_RENEWAL_BOARD_WINDOW);
  });

  it("lee el responsable como texto acotado", () => {
    expect(readRenewalBoardFilters({ owner: "user-1" }).owner).toBe("user-1");
    expect(readRenewalBoardFilters({ owner: "  " }).owner).toBeUndefined();
    expect(readRenewalBoardFilters({}).owner).toBeUndefined();
  });

  it("incluye las vencidas en las ventanas numéricas y las aísla en 'overdue'", () => {
    const upTo30 = renewalWindowRange("30", today);
    expect(upTo30.from).toBeUndefined();
    expect(getBusinessDateKey(upTo30.to!)).toBe("2026-09-06");

    const overdue = renewalWindowRange("overdue", today);
    expect(getBusinessDateKey(overdue.to!)).toBe("2026-08-06");
  });
});

describe("renewal-board.logic — renovaciones estancadas", () => {
  it("no reclama nada sobre etapas terminales", () => {
    expect(
      getRenewalStallState({ stage: "WON", stageChangedAt: parseBusinessDateInput("2020-01-01"), daysUntilRenewal: 1, today }),
    ).toEqual({ stalled: false, reason: null, daysSinceLastMove: null });
    expect(
      getRenewalStallState({ stage: "LOST", stageChangedAt: null, daysUntilRenewal: 1, today }),
    ).toEqual({ stalled: false, reason: null, daysSinceLastMove: null });
  });

  it("marca como estancado lo que nadie ha tocado y ya entró al último mes", () => {
    const near = getRenewalStallState({ stage: "PENDING", stageChangedAt: null, daysUntilRenewal: 20, today });
    expect(near).toEqual({ stalled: true, reason: "never-started", daysSinceLastMove: null });

    const far = getRenewalStallState({ stage: "PENDING", stageChangedAt: null, daysUntilRenewal: 45, today });
    expect(far).toEqual({ stalled: false, reason: null, daysSinceLastMove: null });
  });

  it("usa un umbral distinto por etapa cuando ya hubo un movimiento", () => {
    expect(
      getRenewalStallState({
        stage: "CONTACTED",
        stageChangedAt: parseBusinessDateInput("2026-08-03"),
        daysUntilRenewal: 12,
        today,
      }),
    ).toEqual({ stalled: false, reason: null, daysSinceLastMove: 4 });

    expect(
      getRenewalStallState({
        stage: "CONTACTED",
        stageChangedAt: parseBusinessDateInput("2026-08-02"),
        daysUntilRenewal: 12,
        today,
      }),
    ).toEqual({ stalled: true, reason: "no-progress", daysSinceLastMove: 5 });

    expect(
      getRenewalStallState({
        stage: "PENDING",
        stageChangedAt: parseBusinessDateInput("2026-08-02"),
        daysUntilRenewal: 12,
        today,
      }),
    ).toEqual({ stalled: false, reason: null, daysSinceLastMove: 5 });
  });
});

describe("renewal-board.logic — clave de deduplicación", () => {
  it("agrupa la semana operativa desde el lunes", () => {
    expect(businessWeekKey(parseBusinessDateInput("2026-08-07"))).toBe("2026-08-03");
    expect(businessWeekKey(parseBusinessDateInput("2026-08-03"))).toBe("2026-08-03");
    expect(businessWeekKey(parseBusinessDateInput("2026-08-09"))).toBe("2026-08-03");
    expect(businessWeekKey(parseBusinessDateInput("2026-08-10"))).toBe("2026-08-10");
  });

  it("cambia de clave al cambiar de etapa o de semana", () => {
    expect(renewalFollowUpDedupeKey("p1", "CONTACTED", "2026-08-03")).toBe(
      "RENEWAL_FOLLOWUP:p1:CONTACTED:2026-08-03",
    );
    expect(renewalFollowUpDedupeKey("p1", "QUOTED", "2026-08-03")).not.toBe(
      renewalFollowUpDedupeKey("p1", "CONTACTED", "2026-08-03"),
    );
    expect(renewalFollowUpDedupeKey("p1", "CONTACTED", "2026-08-10")).not.toBe(
      renewalFollowUpDedupeKey("p1", "CONTACTED", "2026-08-03"),
    );
  });
});

describe("renewal-board.logic — texto del recordatorio", () => {
  it("explica el vencimiento y el motivo del estancamiento", () => {
    const started = buildRenewalFollowUpMessage({
      policyNumber: "POL-1",
      clientName: "Ana",
      stageLabel: "Contactado",
      daysUntilRenewal: 9,
      stall: { stalled: true, reason: "no-progress", daysSinceLastMove: 6 },
    });
    expect(started.title).toBe("Renovación sin avance: POL-1");
    expect(started.body).toContain("vence en 9 días");
    expect(started.body).toContain("Sin avance desde hace 6 días.");

    const untouched = buildRenewalFollowUpMessage({
      policyNumber: "POL-2",
      clientName: "Beto",
      stageLabel: "Por vencer",
      daysUntilRenewal: -3,
      stall: { stalled: true, reason: "never-started", daysSinceLastMove: null },
    });
    expect(untouched.body).toContain("venció hace 3 días");
    expect(untouched.body).toContain("Nadie ha registrado avance todavía.");
  });
});

describe("renewal-board.logic — estancamiento fuera de la ventana del tablero", () => {
  const today = parseBusinessDateInput("2026-08-07");

  it("marca como estancada una renovación vencida hace mucho más de 90 días", () => {
    // El tablero se acota a una ventana; el barrido de seguimiento no puede
    // hacerlo, y este es justo el caso que nadie está mirando.
    const state = getRenewalStallState({
      stage: "PENDING",
      stageChangedAt: null,
      daysUntilRenewal: -120,
      today,
    });
    expect(state).toEqual({ stalled: true, reason: "never-started", daysSinceLastMove: null });
  });

  it("marca como estancada una renovación sin avance aunque el vencimiento esté lejos", () => {
    const state = getRenewalStallState({
      stage: "CONTACTED",
      stageChangedAt: parseBusinessDateInput("2026-08-01"),
      daysUntilRenewal: 150,
      today,
    });
    expect(state.stalled).toBe(true);
    expect(state.reason).toBe("no-progress");
    expect(state.daysSinceLastMove).toBe(6);
  });

  it("no reclama una renovación lejana que nadie ha tocado todavía", () => {
    const state = getRenewalStallState({
      stage: "PENDING",
      stageChangedAt: null,
      daysUntilRenewal: 150,
      today,
    });
    expect(state.stalled).toBe(false);
  });
});

describe("renewal-board.logic — identidad del recordatorio", () => {
  it("distingue el pendiente de seguimiento de un pendiente de renovación normal", () => {
    const automaticSourceId = renewalFollowUpWorkItemSourceId("p1");
    const manualSourceId = renewalManualFollowUpWorkItemSourceId("p1");
    expect(automaticSourceId.endsWith(RENEWAL_FOLLOWUP_SOURCE_SUFFIX)).toBe(true);
    expect(manualSourceId).not.toBe(automaticSourceId);
    expect(manualSourceId.endsWith(RENEWAL_FOLLOWUP_SOURCE_SUFFIX)).toBe(false);
    expect(manualSourceId).toBe("policy:p1:renewal-manual-followup");
  });

  it("calcula los accesos rápidos como fechas de negocio estables", () => {
    expect(getBusinessDateKey(renewalFollowUpShortcutDate("tomorrow", today))).toBe("2026-08-08");
    expect(getBusinessDateKey(renewalFollowUpShortcutDate("three-days", today))).toBe("2026-08-10");
    expect(getBusinessDateKey(renewalFollowUpShortcutDate("one-week", today))).toBe("2026-08-14");
  });

  it("sólo permite programar en etapas activas", () => {
    expect(canScheduleRenewalManualFollowUp("PENDING")).toBe(true);
    expect(canScheduleRenewalManualFollowUp("CONTACTED")).toBe(true);
    expect(canScheduleRenewalManualFollowUp("QUOTED")).toBe(true);
    expect(canScheduleRenewalManualFollowUp("WON")).toBe(false);
    expect(canScheduleRenewalManualFollowUp("LOST")).toBe(false);
  });
});
