import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const telegramLinkTokenDeleteManyMock = vi.hoisted(() => vi.fn());
const telegramLinkTokenCreateMock = vi.hoisted(() => vi.fn());
type TelegramLinkTokenTx = {
  telegramLinkToken: {
    deleteMany: typeof telegramLinkTokenDeleteManyMock;
    create: typeof telegramLinkTokenCreateMock;
  };
};
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: TelegramLinkTokenTx) => Promise<unknown>) =>
    callback({
      telegramLinkToken: {
        deleteMany: telegramLinkTokenDeleteManyMock,
        create: telegramLinkTokenCreateMock,
      },
    }),
  ),
);
const logErrorMock = vi.hoisted(() => vi.fn());
const writeActivityLogMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      $transaction: transactionMock,
    }),
  };
});

vi.mock("@/lib/logger", () => {
  return {
    logError: logErrorMock,
  };
});

vi.mock("@/lib/activity-log", () => {
  return {
    writeActivityLog: writeActivityLogMock,
  };
});

vi.mock("./telegram-shared", async () => {
  const actual = await vi.importActual<typeof import("./telegram-shared")>("./telegram-shared");
  return {
    ...actual,
    generateTelegramLinkCode: () => "ABCDEF123456",
  };
});

import { createTelegramLinkCodeForUser } from "./telegram";

describe("telegram link code generation", () => {
  beforeEach(() => {
    telegramLinkTokenDeleteManyMock.mockReset();
    telegramLinkTokenCreateMock.mockReset();
    transactionMock.mockReset();
    logErrorMock.mockReset();
    writeActivityLogMock.mockReset();

    transactionMock.mockImplementation(async (callback: (tx: TelegramLinkTokenTx) => Promise<unknown>) =>
      callback({
        telegramLinkToken: {
          deleteMany: telegramLinkTokenDeleteManyMock,
          create: telegramLinkTokenCreateMock,
        },
      }),
    );
  });

  it("still generates a code if audit logging fails", async () => {
    telegramLinkTokenDeleteManyMock.mockResolvedValue({ count: 0 });
    telegramLinkTokenCreateMock.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      tokenHash: "token-hash",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
      usedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    writeActivityLogMock.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      createTelegramLinkCodeForUser({
        userId: "user-1",
        actorId: "user-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      code: "ABCDEF123456",
      message: "Código de enlace generado. Envíalo por Telegram antes de que expire.",
      redirectTo: "/settings/notifications",
    });

    expect(telegramLinkTokenDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        usedAt: null,
      },
    });
    expect(telegramLinkTokenCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(writeActivityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "TelegramLinkToken",
        entityId: "token-1",
        action: "TELEGRAM_LINK_CODE_GENERATED",
        userId: "user-1",
      }),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      "telegram.createLinkCode.audit",
      expect.any(Error),
      {
        userId: "user-1",
        actorId: "user-1",
      },
    );
  });
});
