import { describe, expect, it } from "vitest";
import { buildOperationalWorkItemPresentation } from "@/lib/operations-presentation";

const now = new Date("2026-08-08T12:00:00.000Z");

describe("operational work item presentation", () => {
  it("marks an active renewal with a past policy end date as overdue", () => {
    expect(buildOperationalWorkItemPresentation({
      sourceType: "Renewal",
      dueDate: new Date("2026-05-12T12:00:00.000Z"),
      policy: { status: "ACTIVE", endDate: new Date("2026-05-27T12:00:00.000Z") },
      now,
    })).toEqual({
      isRenewal: true,
      state: "VENCIDA",
      renewalLabel: "Venció",
      followUpPending: false,
      followUpOverdue: true,
    });
  });

  it("marks a future renewal with an overdue follow-up as urgent", () => {
    expect(buildOperationalWorkItemPresentation({
      sourceType: "Task",
      taskType: "RENEWAL",
      dueDate: new Date("2026-08-01T12:00:00.000Z"),
      policy: { status: "ACTIVE", endDate: new Date("2026-08-20T12:00:00.000Z") },
      now,
    })).toEqual({
      isRenewal: true,
      state: "URGENTE",
      renewalLabel: "Renueva",
      followUpPending: false,
      followUpOverdue: true,
    });
  });

  it("does not infer a renewal state for an inactive or undated policy", () => {
    expect(buildOperationalWorkItemPresentation({
      title: "Renovación: POL-001",
      dueDate: new Date("2026-05-12T12:00:00.000Z"),
      policy: { status: "EXPIRED", endDate: new Date("2026-05-27T12:00:00.000Z") },
      now,
    })).toMatchObject({ isRenewal: true, state: "PENDIENTE", renewalLabel: null, followUpPending: true, followUpOverdue: false });

    expect(buildOperationalWorkItemPresentation({
      sourceType: "Renewal",
      policy: { status: "ACTIVE", endDate: null },
      now,
    })).toMatchObject({ isRenewal: true, state: "PENDIENTE", renewalLabel: null, followUpPending: true, followUpOverdue: false });
  });

  it("does not add renewal status to an ordinary task", () => {
    expect(buildOperationalWorkItemPresentation({
      sourceType: "Task",
      taskType: "GENERAL",
      title: "Llamar al cliente",
      dueDate: new Date("2026-08-01T12:00:00.000Z"),
      now,
    })).toEqual({
      isRenewal: false,
      state: null,
      renewalLabel: null,
      followUpPending: false,
      followUpOverdue: true,
    });
  });
});
