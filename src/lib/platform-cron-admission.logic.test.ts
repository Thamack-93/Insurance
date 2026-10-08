import { describe, expect, it, vi } from "vitest";
import { runWithPlatformCronAdmission } from "./platform-cron-admission.logic";

describe("platform cron admission", () => {
  function dependencies(mode: string | null, options?: { lock?: boolean; modeError?: boolean }) {
    const state = { lockActive: false, acquired: 0 };
    return {
      state,
      dependencies: {
        withSharedLock: async <Value>(run: (readMode: () => Promise<string | null>) => Promise<Value>) => {
          state.acquired += 1;
          if (options?.lock === false) return { acquired: false as const };
          state.lockActive = true;
          try {
            const value = await run(async () => {
              if (options?.modeError) throw new Error("read failed");
              return mode;
            });
            return { acquired: true as const, value };
          } finally {
            state.lockActive = false;
          }
        },
      },
    };
  }

  it("runs work while the shared cutover lock is held and mode is open", async () => {
    const fixture = dependencies("OPEN");
    const work = vi.fn(async () => {
      expect(fixture.state.lockActive).toBe(true);
      return "ran";
    });
    const result = await runWithPlatformCronAdmission(work, fixture.dependencies);

    expect(result).toEqual({ kind: "completed", value: "ran" });
    expect(work).toHaveBeenCalledOnce();
    expect(fixture.state.lockActive).toBe(false);
  });

  it.each(["MAINTENANCE", "READ_ONLY", null, "UNKNOWN"])(
    "blocks work when platform write mode is %s",
    async (mode) => {
      const fixture = dependencies(mode);
      const work = vi.fn(async () => "must-not-run");
      const result = await runWithPlatformCronAdmission(work, fixture.dependencies);

      expect(result).toEqual({ kind: "blocked", mode: mode ?? "UNKNOWN" });
      expect(work).not.toHaveBeenCalled();
      expect(fixture.state.lockActive).toBe(false);
    },
  );

  it("fails closed when write mode cannot be read", async () => {
    const fixture = dependencies("OPEN", { modeError: true });
    const work = vi.fn(async () => "must-not-run");
    const result = await runWithPlatformCronAdmission(work, fixture.dependencies);

    expect(result).toEqual({ kind: "unavailable" });
    expect(work).not.toHaveBeenCalled();
    expect(fixture.state.lockActive).toBe(false);
  });

  it("does not run work if the transaction-scoped admission lock is unavailable", async () => {
    const fixture = dependencies("OPEN", { lock: false });
    const work = vi.fn(async () => "must-not-run");
    const result = await runWithPlatformCronAdmission(work, fixture.dependencies);

    expect(result).toEqual({ kind: "unavailable" });
    expect(work).not.toHaveBeenCalled();
    expect(fixture.state.acquired).toBe(1);
  });
});
