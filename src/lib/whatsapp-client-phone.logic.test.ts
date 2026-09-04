import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const writeActivityLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));

import { resolveClientWhatsAppPhone } from "./whatsapp-client-phone";

const client = { id: "client-a", phone: null, secondaryPhone: null };

describe("shared WhatsApp client phone capture", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes and saves a captured phone with the exact optimistic predicate", async () => {
    const tx = { client: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as never;
    await expect(resolveClientWhatsAppPhone({ tx, organizationId: "org-a", userId: "user-a", client, capturedPhone: "55 1234 5678", source: "RENEWAL_CONTACT" })).resolves.toEqual({ normalized: "+525512345678", source: "CAPTURED" });
    expect((tx as { client: { updateMany: ReturnType<typeof vi.fn> } }).client.updateMany).toHaveBeenCalledWith({ where: { id: "client-a", organizationId: "org-a", phone: null, secondaryPhone: null }, data: { phone: "+525512345678", updatedById: "user-a" } });
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLIENT_PHONE_CAPTURED_FOR_WHATSAPP", newValue: { captured: true, source: "RENEWAL_CONTACT" } }));
  });

  it("rejects a concurrent change instead of overwriting it", async () => {
    const tx = { client: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never;
    await expect(resolveClientWhatsAppPhone({ tx, organizationId: "org-a", userId: "user-a", client, capturedPhone: "55 1234 5678", source: "RENEWAL_CONTACT" })).rejects.toThrow("cambió");
    expect(writeActivityLog).not.toHaveBeenCalled();
  });
});
