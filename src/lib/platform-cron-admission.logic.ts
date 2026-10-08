export type CronAdmissionResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "blocked"; mode: string }
  | { kind: "busy" }
  | { kind: "unavailable" };

export async function runWithPlatformCronAdmission<T>(
  work: () => Promise<T>,
  dependencies: {
    withSharedLock: <Value>(
      run: (readWriteMode: () => Promise<string | null>) => Promise<Value>,
    ) => Promise<{ acquired: false } | { acquired: true; value: Value } | { acquired: true; failure: "busy" }>;
  },
): Promise<CronAdmissionResult<T>> {
  let outcome: { acquired: false } | { acquired: true; value: CronAdmissionResult<T> } | { acquired: true; failure: "busy" };
  let workError: unknown;
  let workFailed = false;
  try {
    outcome = await dependencies.withSharedLock(async (readWriteMode) => {
      let mode: string | null;
      try {
        mode = await readWriteMode();
      } catch {
        return { kind: "unavailable" } as const;
      }
      if (mode !== "OPEN") return { kind: "blocked", mode: mode ?? "UNKNOWN" } as const;
      try {
        return { kind: "completed", value: await work() } as const;
      } catch (error) {
        workFailed = true;
        workError = error;
        throw error;
      }
    });
  } catch {
    if (workFailed) throw workError;
    return { kind: "unavailable" };
  }
  if (!outcome.acquired) return { kind: "unavailable" };
  if ("failure" in outcome) return { kind: "busy" };
  return outcome.value;
}
