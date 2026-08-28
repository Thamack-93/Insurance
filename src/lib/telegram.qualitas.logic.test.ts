import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const checkDistributedRateLimit = vi.hoisted(() => vi.fn());
const writeActivityLog = vi.hoisted(() => vi.fn());
const provider = vi.hoisted(() => ({
  isQualitasInsurerName: vi.fn(() => true),
  isQualitasPaymentLinkEnabled: vi.fn(() => true),
  maskQualitasEmail: vi.fn((email: string) => `${email.slice(0, 1)}***@${email.split("@")[1]}`),
  normalizeQualitasEmail: vi.fn((email: string | null | undefined) => {
    const value = email?.trim().toLowerCase() ?? "";
    return value.includes("@") ? value : null;
  }),
  normalizeQualitasPhone: vi.fn((phone: string | null | undefined) => {
    const value = (phone ?? "").replace(/\D/g, "");
    return value.length === 10 ? value : null;
  }),
  maskQualitasPhone: vi.fn((phone: string) => `••••••${phone.slice(-4)}`),
  prepareQualitasPaymentLink: vi.fn(async () => ({ transportReady: true })),
  requestQualitasPaymentLink: vi.fn(async () => ({ outcome: "SUCCESS" as const, reason: "SUCCESS_CODE_0" as const })),
}));

const db = vi.hoisted(() => ({
  notificationChannel: { findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  policy: { findFirst: vi.fn() },
  telegramDraft: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/request-guards", () => ({
  checkDistributedRateLimit,
  securityFingerprint: (value: string) => `fingerprint:${value}`,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("@/lib/qualitas-payment-link", () => provider);

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
  organizationId: "org-1",
  role: "AGENT",
  active: true,
  organization: { status: "ACTIVE" },
  user: { id: "user-1", email: "agent@example.com", name: "Agent", active: true },
};

const policy = {
  id: "policy-1",
  policyNumber: "1234567890",
  clientId: "client-1",
  insurerId: "insurer-1",
  client: { id: "client-1", fullName: "Cliente Uno", email: "client@example.com", phone: "5550101234", organizationId: "org-1" },
  insurer: { id: "insurer-1", name: "Qualitas", organizationId: "org-1" },
};

function draftWith(qualitas: Record<string, unknown>) {
  return {
    id: "draft-1",
    organizationId: "org-1",
    userId: "user-1",
    channelId: "channel-1",
    type: "QUALITAS_PAYMENT_LINK",
    status: "COLLECTING",
    payloadJson: JSON.stringify({ type: "QUALITAS_PAYMENT_LINK", qualitas }),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function message(text: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: { message_id: 10, chat: { id: 123, type: "private" }, text },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.notificationChannel.findFirst.mockResolvedValue(channel);
  db.organizationMembership.findFirst.mockResolvedValue({ organizationId: "org-1" });
  db.organizationMembership.findMany.mockResolvedValue([membership]);
  db.policy.findFirst.mockResolvedValue(policy);
  db.telegramDraft.findFirst.mockResolvedValue(null);
  db.telegramDraft.create.mockResolvedValue(draftWith({ step: "policyNumber" }));
  db.telegramDraft.update.mockResolvedValue({});
  db.telegramDraft.updateMany.mockResolvedValue({ count: 0 });
  db.$transaction.mockImplementation(async (callback: (transaction: typeof db) => unknown) => callback(db));
  checkDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterMs: 0, backend: "local" });
});

describe("Telegram Quálitas payment-link flow", () => {
  it("creates a recipient draft with fixed, non-sensitive callback data", async () => {
    const result = await processTelegramWebhookUpdate(message("/pagoqualitas 1234567890"));

    expect(result.replyMarkup).toEqual({
      inline_keyboard: [[
        { text: "Cliente", callback_data: "qualitas_recipient_client" },
        { text: "Agente", callback_data: "qualitas_recipient_agent" },
      ]],
    });
    expect(JSON.stringify(result.replyMarkup)).not.toContain("client@example.com");
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("asks for a policy number when the command argument is omitted", async () => {
    const result = await processTelegramWebhookUpdate(message("/pagoqualitas"));

    expect(result.replyText).toContain("número de póliza");
    expect(result.replyMarkup).toBeUndefined();
  });

  it("offers only the currently available recipient", async () => {
    db.policy.findFirst.mockResolvedValue({ ...policy, client: { ...policy.client, email: null, phone: null } });

    const result = await processTelegramWebhookUpdate(message("/pagoqualitas 1234567890"));

    expect(result.replyMarkup).toEqual({
      inline_keyboard: [[{ text: "Agente", callback_data: "qualitas_recipient_agent" }]],
    });
  });

  it("blocks the flow when neither email is valid", async () => {
    db.policy.findFirst.mockResolvedValue({ ...policy, client: { ...policy.client, email: null, phone: null } });
    db.organizationMembership.findMany.mockResolvedValue([{ ...membership, user: { ...membership.user, email: "invalid" } }]);

    const result = await processTelegramWebhookUpdate(message("/pagoqualitas 1234567890"));

    expect(result.replyText).toMatch(/No hay un correo válido disponible/i);
    expect(db.telegramDraft.create).not.toHaveBeenCalled();
  });

  it("updates the existing draft from a valid callback and never contacts Quálitas", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "recipient",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate({
      update_id: 2,
      callback_query: {
        id: "callback-1",
        from: { id: 123 },
        message: { message_id: 10, chat: { id: 123, type: "private" } },
        data: "qualitas_recipient_client",
      },
    });

    expect(result.callbackQueryId).toBe("callback-1");
    expect(result.removeReplyMarkup).toBe(true);
    expect(result.replyText).toContain("¿Por qué medio quieres enviar");
    expect(result.replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: "Correo", callback_data: "qualitas_channel_email" },
          { text: "WhatsApp", callback_data: "qualitas_channel_whatsapp" },
        ],
      ],
    });
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("rejects tampered or foreign callback data without loading a provider draft", async () => {
    const result = await processTelegramWebhookUpdate({
      update_id: 3,
      callback_query: {
        id: "callback-2",
        from: { id: 999 },
        message: { message_id: 10, chat: { id: 123, type: "private" } },
        data: "qualitas_recipient_client:other-policy",
      },
    });

    expect(result.callbackAnswerText).toBe("Selección no válida.");
    expect(db.telegramDraft.findFirst).not.toHaveBeenCalled();
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("selects WhatsApp as an explicit channel without contacting Quálitas", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "channel",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      clientPhone: "5550101234",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientEmail: "client@example.com",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate({
      update_id: 4,
      callback_query: {
        id: "callback-channel-1",
        from: { id: 123 },
        message: { message_id: 10, chat: { id: 123, type: "private" } },
        data: "qualitas_channel_whatsapp",
      },
    });

    expect(result.callbackAnswerText).toBe("Canal seleccionado.");
    expect(result.replyText).toContain("WhatsApp · ••••••1234");
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("offers WhatsApp for an agent and asks for the number when it is not stored", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "channel",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      clientPhone: "5550101234",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "AGENT",
      recipientEmail: "agent@example.com",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate({
      update_id: 5,
      callback_query: {
        id: "callback-agent-whatsapp",
        from: { id: 123 },
        message: { message_id: 10, chat: { id: 123, type: "private" } },
        data: "qualitas_channel_whatsapp",
      },
    });

    expect(result.callbackAnswerText).toBe("Falta el teléfono.");
    expect(result.replyText).toContain("número de WhatsApp de 10 dígitos");
    expect(result.removeReplyMarkup).toBe(true);
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("accepts cliente text fallback and requires confirmation", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "recipient",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate(message("cliente"));

    expect(result.replyText).toContain("¿Por qué medio quieres enviar");
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("blocks confirmation when the selected email changed", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "old@example.com",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientEmail: "old@example.com",
      deliveryMethod: "EMAIL",
    }));

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("El destino cambió");
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("claims confirmation once and records a safe audit event", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientEmail: "client@example.com",
      deliveryMethod: "EMAIL",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("Solicitud enviada a Quálitas");
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "QUALITAS_PAYMENT_LINK_REQUESTED",
      entityId: "policy-1",
      newValue: expect.objectContaining({ recipientType: "CLIENT", result: "SUCCESS", reason: "SUCCESS_CODE_0" }),
    }));
    expect(JSON.stringify(writeActivityLog.mock.calls[0])).not.toContain("client@example.com");
  });

  it("confirms a WhatsApp request with the client phone and never sends an email", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      clientPhone: "5550101234",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientPhone: "5550101234",
      deliveryMethod: "WHATSAPP",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("WhatsApp · ••••••1234");
    expect(provider.prepareQualitasPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: null,
      recipientPhone: "5550101234",
      deliveryMethod: "WHATSAPP",
    }), expect.anything());
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writeActivityLog.mock.calls[0])).not.toContain("5550101234");
  });

  it("keeps legacy ready drafts usable as email requests", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      clientPhone: "5550101234",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientEmail: "client@example.com",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("Correo · c***@example.com");
    expect(provider.prepareQualitasPaymentLink).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: "client@example.com",
      recipientPhone: null,
      deliveryMethod: "EMAIL",
    }), expect.anything());
  });

  it("does not execute when another confirmation already claimed the draft", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "CLIENT",
      recipientEmail: "client@example.com",
      deliveryMethod: "EMAIL",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 0 });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toMatch(/ya fue procesada|está siendo procesada/i);
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });
});
