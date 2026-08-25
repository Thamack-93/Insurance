import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.hoisted(() => vi.fn());
const syncTelegramWebhook = vi.hoisted(() => vi.fn());
const createPlatformAudit = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

const MockAuthError = vi.hoisted(() => class MockAuthError extends Error {
  status = 403;
});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireSuperAdmin, AuthError: MockAuthError }));
vi.mock("@/lib/telegram", () => ({ syncTelegramWebhook }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ platformAuditLog: { create: createPlatformAudit } }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { syncPlatformTelegramWebhookAction } from "@/app/(dashboard)/platform/telegram-actions";

describe("platform Telegram webhook action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ id: "superadmin-1" });
    syncTelegramWebhook.mockResolvedValue({ ok: true, message: "Webhook sincronizado." });
  });

  it("allows SUPERADMIN and writes only a platform audit", async () => {
    const result = await syncPlatformTelegramWebhookAction();
    expect(syncTelegramWebhook).toHaveBeenCalledWith();
    expect(createPlatformAudit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "TELEGRAM_WEBHOOK_SYNCED" }) }));
    expect(result).toMatchObject({ ok: true });
  });

  it("fails closed for a tenant administrator", async () => {
    requireSuperAdmin.mockRejectedValue(new MockAuthError("Acceso exclusivo de SUPERADMIN."));
    const result = await syncPlatformTelegramWebhookAction();
    expect(syncTelegramWebhook).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
  });
});
