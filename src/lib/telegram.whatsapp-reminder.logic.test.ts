import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const checkDistributedRateLimit = vi.hoisted(() => vi.fn());
const writeActivityLog = vi.hoisted(() => vi.fn());
const assertOrganizationContextInTransaction = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  notificationChannel: { findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  receipt: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  telegramDraft: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  client: { updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/request-guards", () => ({
  checkDistributedRateLimit,
  securityFingerprint: (value: string) => `fingerprint:${value}`,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("@/lib/organization-context", () => ({ assertOrganizationContextInTransaction }));

import { processTelegramWebhookUpdate } from "./telegram";

const channel = {
  id: "channel-1",
  userId: "user-1",
  type: "TELEGRAM",
  telegramChatId: "123",
  isEnabled: true,
  telegramMutationsEnabled: true,
};

const membership = {
  id: "membership-1",
  organizationId: "org-1",
  role: "AGENT",
  active: true,
  organization: { id: "org-1", name: "Org", slug: "org", status: "ACTIVE" },
  user: { id: "user-1", email: "agent@example.com", name: "Agente", phone: null, active: true, role: "USER", platformRole: "NONE" },
};

function makeReceipt(phone: string | null = "+525512345678") {
  return {
    id: "receipt-1",
    receiptNumber: "REC-1",
    dueDate: new Date("2026-08-31T06:00:00.000Z"),
    amount: 1200,
    currency: "MXN",
    client: { id: "client-1", fullName: "Ana Pérez", phone, secondaryPhone: null },
    policy: { id: "policy-1", policyNumber: "POL-123456", clientId: "client-1" },
    insurer: { name: "Aseguradora Demo" },
    payments: [],
  };
}

function makeDraft(receipt = makeReceipt(null)) {
  return {
    id: "draft-1",
    organizationId: "org-1",
    userId: "user-1",
    channelId: "channel-1",
    type: "WHATSAPP_RECEIPT_REMINDER",
    status: "COLLECTING",
    payloadJson: JSON.stringify({
      type: "WHATSAPP_RECEIPT_REMINDER",
      whatsappReminder: {
        step: "phone",
        receiptId: receipt.id,
        policyNumber: receipt.policy.policyNumber,
        receiptNumber: receipt.receiptNumber,
        clientName: receipt.client.fullName,
      },
    }),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function message(text: string) {
  return { update_id: Math.floor(Math.random() * 100000), message: { message_id: 1, chat: { id: 123, type: "private" }, text } };
}

beforeEach(() => {
  vi.clearAllMocks();
  checkDistributedRateLimit.mockResolvedValue({ allowed: true });
  assertOrganizationContextInTransaction.mockResolvedValue(undefined);
  db.notificationChannel.findFirst.mockResolvedValue(channel);
  db.organizationMembership.findMany.mockResolvedValue([membership]);
  db.organizationMembership.findFirst.mockResolvedValue({ organizationId: "org-1" });
  db.telegramDraft.findFirst.mockResolvedValue(null);
  db.telegramDraft.create.mockResolvedValue(makeDraft());
  db.telegramDraft.update.mockResolvedValue({});
  db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });
  db.client.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  db.receipt.findFirst.mockResolvedValue(makeReceipt());
  db.receipt.findMany.mockResolvedValue([{ ...makeReceipt(), policy: { ...makeReceipt().policy, status: "ACTIVE" }, endorsement: null, payments: [] }]);
});

describe("Telegram manual WhatsApp reminder", () => {
  it("prepares a wa.me URL from a receipt command without sending WhatsApp", async () => {
    const result = await processTelegramWebhookUpdate(message("/recordar POL-123456 REC-1"));

    expect(result.replyText).toContain("No se ha enviado");
    expect(result.replyMarkup?.inline_keyboard[0]?.[0]).toMatchObject({
      text: "Abrir WhatsApp · mensaje aún no enviado",
      url: expect.stringMatching(/^https:\/\/wa\.me\/525512345678\?text=/),
    });
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "WHATSAPP_REMINDER_PREPARED",
      newValue: expect.objectContaining({ sourceChannel: "TELEGRAM", status: "HANDOFF_PREPARED_NOT_SENT" }),
    }));
    expect(JSON.stringify(writeActivityLog.mock.calls)).not.toContain("525512345678");
  });

  it("asks for and then saves a missing phone before preparing the handoff", async () => {
    const receipt = makeReceipt(null);
    const draft = makeDraft(receipt);
    db.receipt.findFirst.mockResolvedValue(receipt);
    db.telegramDraft.create.mockResolvedValue(draft);

    const first = await processTelegramWebhookUpdate(message("/recordar POL-123456 REC-1"));
    expect(first.replyText).toContain("Escribe 10 dígitos");

    db.telegramDraft.findFirst.mockResolvedValue(draft);
    const second = await processTelegramWebhookUpdate(message("55 1234 5678"));
    expect(second.replyText).toContain("Teléfono listo");
    expect(second.replyMarkup?.inline_keyboard[0]?.[0]).toMatchObject({ callback_data: "whatsapp_reminder_confirm" });

    db.telegramDraft.findFirst.mockResolvedValue({ ...draft, payloadJson: JSON.stringify({
      type: "WHATSAPP_RECEIPT_REMINDER",
      whatsappReminder: { step: "ready", receiptId: receipt.id, policyNumber: receipt.policy.policyNumber, receiptNumber: receipt.receiptNumber, clientName: receipt.client.fullName, capturedPhone: "+525512345678" },
    }) });
    const third = await processTelegramWebhookUpdate({
      update_id: 3,
      callback_query: { id: "callback-1", from: { id: 123 }, message: { message_id: 1, chat: { id: 123, type: "private" } }, data: "whatsapp_reminder_confirm" },
    });

    expect(third.replyMarkup?.inline_keyboard[0]?.[0]).toMatchObject({ text: "Abrir WhatsApp · mensaje aún no enviado" });
    expect(db.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { phone: "+525512345678", updatedById: "user-1" } }));
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLIENT_PHONE_CAPTURED_FOR_WHATSAPP" }));
  });

  it("keeps receipt browsing available when mutations are disabled", async () => {
    channel.telegramMutationsEnabled = false;
    db.receipt.findFirst.mockResolvedValue(makeReceipt());
    db.telegramDraft.findFirst.mockResolvedValue(null);

    const result = await processTelegramWebhookUpdate(message("/recordar"));

    expect(result.replyText).toContain("Selecciona el recibo");
    const firstButton = result.replyMarkup?.inline_keyboard[0]?.[0];
    expect(firstButton && "callback_data" in firstButton ? firstButton.callback_data : null).toContain("digest_receipt:");
  });
});
