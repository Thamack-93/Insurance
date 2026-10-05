import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const checkDistributedRateLimit = vi.hoisted(() => vi.fn());
const isTenantTransactionClient = vi.hoisted(() => vi.fn(() => false));
const globalSearch = vi.hoisted(() => vi.fn());
const writeActivityLog = vi.hoisted(() => vi.fn());
const recordPayment = vi.hoisted(() => vi.fn());
const provider = vi.hoisted(() => ({
  isQualitasInsurerName: vi.fn(() => true),
  isQualitasPaymentLinkEnabled: vi.fn(() => true),
  isQualitasClientRecipientEnabled: vi.fn(() => process.env.QUALITAS_PAYMENT_LINK_CLIENT_RECIPIENT_ENABLED === "true"),
  maskQualitasEmail: vi.fn((email: string) => `${email.slice(0, 1)}***@${email.split("@")[1]}`),
  normalizeQualitasEmail: vi.fn((email: string | null | undefined) => {
    const value = email?.trim().toLowerCase() ?? "";
    return value.includes("@") ? value : null;
  }),
  normalizeQualitasPhone: vi.fn((phone: string | null | undefined) => {
    const raw = (phone ?? "").replace(/\D/g, "");
    const value = raw.length === 12 && raw.startsWith("52") ? raw.slice(2) : raw;
    return value.length === 10 ? value : null;
  }),
  maskQualitasPhone: vi.fn((phone: string) => `••••••${phone.slice(-4)}`),
  prepareQualitasPaymentLink: vi.fn(async () => ({ transportReady: true })),
  requestQualitasPaymentLink: vi.fn(async () => ({ outcome: "SUCCESS" as const, reason: "SUCCESS_CODE_0" as const })),
}));

const db = vi.hoisted(() => ({
  notificationChannel: { findFirst: vi.fn() },
  organizationMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  receipt: { findFirst: vi.fn(), findMany: vi.fn() },
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
vi.mock("@/lib/payment-service", () => ({ recordPayment }));
vi.mock("@/lib/search", () => ({ globalSearch }));
vi.mock("@/lib/organization-context", () => ({
  assertOrganizationContextInTransaction: vi.fn(async () => {}),
  isTenantTransactionClient,
  withSystemOrganizationTransaction: vi.fn(async (_organizationId: string, _reason: string, callback: (tx: typeof db) => unknown) => callback(db)),
}));
vi.mock("@/lib/organization-capabilities", () => ({
  resolveOrganizationCapability: vi.fn(async (organizationId: string, capability: string) => ({
    organizationId,
    capability,
    enabled: true,
    limitValue: null,
    reason: "PLAN",
  })),
}));
vi.mock("@/lib/qualitas-payment-link", () => provider);

import { buildTelegramSearchReply, processTelegramWebhookUpdate } from "./telegram";

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
  const currentShape = qualitas.step !== "ready" || qualitas.deliveryMethod
    ? { correlationId: "draft-correlation", submissionState: "NOT_STARTED" }
    : {};
  return {
    id: "draft-1",
    organizationId: "org-1",
    userId: "user-1",
    channelId: "channel-1",
    type: "QUALITAS_PAYMENT_LINK",
    status: "COLLECTING",
    payloadJson: JSON.stringify({ type: "QUALITAS_PAYMENT_LINK", qualitas: { ...currentShape, ...qualitas } }),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function message(text: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: { message_id: 10, chat: { id: 123, type: "private" }, text },
  };
}

function paymentDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-draft-1",
    organizationId: "org-1",
    userId: "user-1",
    channelId: "channel-1",
    type: "PAYMENT_CAPTURE",
    status: "COLLECTING",
    payloadJson: JSON.stringify({
      type: "PAYMENT_CAPTURE",
      payment: {
        step: "ready",
        policyNumber: "940448838",
        receiptNumber: "6",
        paidDate: "2026-09-16",
        paymentMethod: "TRANSFER",
        amount: 100,
        reference: null,
        ...overrides,
      },
    }),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

const paymentReceipt = {
  id: "receipt-1",
  organizationId: "org-1",
  receiptNumber: "6",
  policyId: "policy-1",
  clientId: "client-1",
  insurerId: "insurer-1",
  amount: 100,
  currency: "MXN",
  status: "PENDING",
  client: { fullName: "Cliente Uno" },
  policy: { policyNumber: "940448838" },
  insurer: { name: "Aseguradora" },
  endorsement: null,
  payments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  isTenantTransactionClient.mockReturnValue(false);
  process.env.QUALITAS_PAYMENT_LINK_CLIENT_RECIPIENT_ENABLED = "true";
  db.notificationChannel.findFirst.mockResolvedValue(channel);
  db.organizationMembership.findFirst.mockResolvedValue({ organizationId: "org-1" });
  db.organizationMembership.findMany.mockResolvedValue([membership]);
  globalSearch.mockResolvedValue([{ id: "work-1", type: "workItem", title: "Pendiente", href: "/tasks/work-1" }]);
  db.policy.findFirst.mockResolvedValue(policy);
  db.receipt.findFirst.mockResolvedValue(paymentReceipt);
  db.receipt.findMany.mockResolvedValue([]);
  db.telegramDraft.findFirst.mockResolvedValue(null);
  db.telegramDraft.create.mockResolvedValue(draftWith({ step: "policyNumber" }));
  db.telegramDraft.update.mockResolvedValue({});
  db.telegramDraft.updateMany.mockResolvedValue({ count: 0 });
  db.$transaction.mockImplementation(async (callback: (transaction: typeof db) => unknown) => callback(db));
  provider.requestQualitasPaymentLink.mockResolvedValue({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" });
  recordPayment.mockReset();
  checkDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 10, retryAfterMs: 0, backend: "local" });
});

describe("Telegram Quálitas payment-link flow", () => {
  it("passes an existing tenant transaction through Telegram search", async () => {
    const transaction = { organizationMembership: { findFirst: vi.fn().mockResolvedValue({ organizationId: "org-1" }) } };
    isTenantTransactionClient.mockReturnValue(true);

    const reply = await buildTelegramSearchReply("user-1", "pendiente", transaction as never);

    expect(reply).toContain("Pendiente");
    expect(globalSearch).toHaveBeenCalledWith("pendiente", "user-1", "org-1", transaction);
  });

  it("keeps client delivery disabled unless the rollout gate is explicitly enabled", async () => {
    process.env.QUALITAS_PAYMENT_LINK_CLIENT_RECIPIENT_ENABLED = "false";

    const result = await processTelegramWebhookUpdate(message("/pagoqualitas 1234567890"));

    expect(result.replyMarkup).toEqual({
      inline_keyboard: [[{ text: "Agente", callback_data: "qualitas_recipient_agent" }]],
    });
    expect(JSON.stringify(result.replyMarkup)).not.toContain("cliente");
  });

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

  it("reuses the agent phone stored on the user profile", async () => {
    db.organizationMembership.findMany.mockResolvedValue([{
      ...membership,
      user: { ...membership.user, phone: "+525550101234" },
    }]);
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "recipient",
      policyId: "policy-1",
      policyNumber: "1234567890",
      clientId: "client-1",
      clientName: "Cliente Uno",
      clientEmail: "client@example.com",
      clientPhone: "5550101234",
      agentUserId: "user-1",
      agentEmail: "agent@example.com",
      recipient: "AGENT",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });

    const result = await processTelegramWebhookUpdate({
      update_id: 6,
      callback_query: {
        id: "callback-agent-profile",
        from: { id: 123 },
        message: { message_id: 10, chat: { id: 123, type: "private" } },
        data: "qualitas_recipient_agent",
      },
    });

    expect(result.replyText).toContain("WhatsApp: ••••••1234");
    expect(result.replyMarkup).toEqual({
      inline_keyboard: [[
        { text: "Correo", callback_data: "qualitas_channel_email" },
        { text: "WhatsApp", callback_data: "qualitas_channel_whatsapp" },
      ]],
    });
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
      deliveryChannel: "WHATSAPP",
      destination: "5550101234",
      correlationId: expect.any(String),
    }), expect.anything());
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writeActivityLog.mock.calls[0])).not.toContain("5550101234");
  });

  it("treats Quálitas 99991 as a terminal acknowledged duplicate", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready", policyId: "policy-1", policyNumber: "1234567890", clientId: "client-1",
      clientName: "Cliente Uno", agentUserId: "user-1", agentEmail: "agent@example.com",
      recipient: "AGENT", recipientEmail: "agent@example.com", deliveryMethod: "EMAIL",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });
    provider.requestQualitasPaymentLink.mockResolvedValue({ outcome: "ALREADY_IN_PROGRESS" as never, reason: "DUPLICATE_LINK_99991" as never });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toBe("Quálitas indica que ya hay otra liga de pago en proceso para esta póliza.");
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      newValue: expect.objectContaining({ result: "ALREADY_IN_PROGRESS" }),
    }));
  });

  it("persists post-submit uncertainty without retrying", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(draftWith({
      step: "ready", policyId: "policy-1", policyNumber: "1234567890", clientId: "client-1",
      clientName: "Cliente Uno", agentUserId: "user-1", agentEmail: "agent@example.com",
      recipient: "AGENT", recipientEmail: "agent@example.com", deliveryMethod: "EMAIL",
    }));
    db.telegramDraft.updateMany.mockResolvedValue({ count: 1 });
    provider.requestQualitasPaymentLink.mockResolvedValue({ outcome: "UNCERTAIN_POST_SUBMISSION" as never, reason: "FINAL_TIMEOUT" as never });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("No se reenviará automáticamente");
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      newValue: expect.objectContaining({ result: "UNCERTAIN" }),
    }));
  });

  it("rejects legacy ready drafts without an explicit channel", async () => {
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

    expect(result.replyText).toContain("todavía no está completa");
    expect(provider.prepareQualitasPaymentLink).not.toHaveBeenCalled();
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

describe("Telegram payment capture confirmation", () => {
  it("reuses the existing webhook transaction instead of nesting Prisma transactions", async () => {
    isTenantTransactionClient.mockReturnValue(true);
    db.telegramDraft.findFirst.mockResolvedValue(paymentDraft());
    recordPayment.mockResolvedValue({ payment: { id: "payment-1" } });

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("Pago confirmado.");
    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a manual draft when the receipt already has a posted payment", async () => {
    db.receipt.findFirst.mockResolvedValue({ ...paymentReceipt, payments: [{ id: "payment-1" }] });

    const result = await processTelegramWebhookUpdate(message("/pago 940448838 6 hoy TRANSFER"));

    expect(result.replyText).toContain("ya tiene un pago registrado");
    expect(db.telegramDraft.create).not.toHaveBeenCalled();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("explains an existing-payment conflict during confirmation without duplicating the payment", async () => {
    db.telegramDraft.findFirst.mockResolvedValue(paymentDraft());
    recordPayment.mockRejectedValue(new Error("No se permiten abonos: este recibo ya tiene un pago registrado."));

    const result = await processTelegramWebhookUpdate(message("/confirmar"));

    expect(result.replyText).toContain("ya tiene un pago registrado");
    expect(result.replyText).toContain("No se aplicó otro pago");
    expect(recordPayment).toHaveBeenCalledTimes(1);
  });
});
