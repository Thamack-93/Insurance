import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const writeActivityLog = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin,
}));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { createInsurer, deleteInsurer, updateInsurer } from "@/app/(dashboard)/insurers/actions";

const insurerValues = {
  name: "Aseguradora de prueba",
  portalUrl: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  notes: "",
  status: "ACTIVE" as const,
};

function makeDb() {
  return {
    insurer: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe("insurer mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockRejectedValue(new Error("Esta acción requiere permisos de administrador."));
  });

  it.each([
    ["create", () => createInsurer(insurerValues)],
    ["update", () => updateInsurer("insurer-1", insurerValues)],
    ["delete", () => deleteInsurer("insurer-1")],
  ])("requires an administrator before %s", async (_operation, invoke) => {
    const db = makeDb();
    getDb.mockReturnValue(db);

    const result = await invoke();

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(db.insurer.create).not.toHaveBeenCalled();
    expect(db.insurer.findUnique).not.toHaveBeenCalled();
    expect(db.insurer.update).not.toHaveBeenCalled();
    expect(db.insurer.delete).not.toHaveBeenCalled();
  });
});
