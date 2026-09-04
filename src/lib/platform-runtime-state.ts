import "server-only";

import { getDb } from "@/lib/db";

export type PlatformWriteMode = "OPEN" | "MAINTENANCE" | "READ_ONLY";

/**
 * The write-mode row is an operational control, not an application mutation.
 * Keep this symbol only as a compatibility guard for old imports: changing
 * it from a request/runtime path would require the administrative credential
 * and would violate the runtime role boundary. Use `scripts/enter-maintenance`
 * (or the reviewed operator workflow) instead.
 */
export async function setPlatformWriteMode(writeMode: PlatformWriteMode, reason: string) {
  void writeMode;
  void reason;
  throw new Error("PLATFORM_WRITE_MODE_OPERATOR_ONLY");
}

export async function getPlatformWriteMode() {
  const db = getDb();
  const state = await db.platformRuntimeState.findUnique({ where: { id: 1 }, select: { writeMode: true, reason: true, updatedAt: true } });
  return state ?? { writeMode: "OPEN" as const, reason: null, updatedAt: null };
}
