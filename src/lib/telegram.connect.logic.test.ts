import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type TelegramLinkTokenRow = {
  id: string;
  organizationId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

type NotificationChannelRow = {
  id: string;
  userId: string;
  type: string;
  telegramChatId: string | null;
  isEnabled: boolean;
  telegramMutationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type TelegramConnectTx = {
  telegramLinkToken: {
    findFirst: typeof telegramLinkTokenFindFirstMock;
    update: typeof telegramLinkTokenUpdateMock;
  };
  notificationChannel: {
    upsert: typeof notificationChannelUpsertMock;
    findUnique: typeof notificationChannelFindUniqueMock;
    findFirst: typeof notificationChannelFindFirstMock;
  };
  notificationPreference: {
    upsert: typeof notificationPreferenceUpsertMock;
  };
};

const telegramLinkTokenFindFirstMock = vi.hoisted(() => vi.fn());
const telegramLinkTokenUpdateMock = vi.hoisted(() => vi.fn());
const notificationChannelUpsertMock = vi.hoisted(() => vi.fn());
const notificationChannelFindUniqueMock = vi.hoisted(() => vi.fn());
const notificationChannelFindFirstMock = vi.hoisted(() => vi.fn());
const notificationPreferenceUpsertMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
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

import { connectTelegramChannelFromCode } from "./telegram";

describe("telegram connect flow", () => {
  beforeEach(() => {
    telegramLinkTokenFindFirstMock.mockReset();
    telegramLinkTokenUpdateMock.mockReset();
    notificationChannelUpsertMock.mockReset();
    notificationChannelFindUniqueMock.mockReset();
    notificationChannelFindFirstMock.mockReset();
    notificationPreferenceUpsertMock.mockReset();
    transactionMock.mockReset();
    logErrorMock.mockReset();
    writeActivityLogMock.mockReset();

    transactionMock.mockImplementation(async (callback: (tx: TelegramConnectTx) => Promise<unknown>) =>
      callback({
        telegramLinkToken: {
          findFirst: telegramLinkTokenFindFirstMock,
          update: telegramLinkTokenUpdateMock,
        },
        notificationChannel: {
          upsert: notificationChannelUpsertMock,
          findUnique: notificationChannelFindUniqueMock,
          findFirst: notificationChannelFindFirstMock,
        },
        notificationPreference: {
          upsert: notificationPreferenceUpsertMock,
        },
      }),
    );
  });

  it("keeps linking successful even when audit logging fails", async () => {
    const token: TelegramLinkTokenRow = {
      id: "token-1",
      organizationId: "org-1",
      userId: "user-1",
      tokenHash: "token-hash",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
      usedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const previousChannel: NotificationChannelRow = {
      id: "channel-1",
      userId: "user-1",
      type: "TELEGRAM",
      telegramChatId: "123456789",
      isEnabled: true,
      telegramMutationsEnabled: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const linkedChannel: NotificationChannelRow = {
      ...previousChannel,
      updatedAt: new Date("2026-01-01T00:10:00.000Z"),
    };

    telegramLinkTokenFindFirstMock.mockResolvedValue(token);
    notificationChannelFindFirstMock.mockResolvedValue(null);
    notificationChannelFindUniqueMock.mockResolvedValue(previousChannel);
    notificationChannelUpsertMock.mockResolvedValue(linkedChannel);
    telegramLinkTokenUpdateMock.mockResolvedValue({
      ...token,
      usedAt: new Date("2026-01-01T00:05:00.000Z"),
    });
    writeActivityLogMock.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      connectTelegramChannelFromCode({
        code: "ABCD12EF3456",
        chatId: "123456789",
        chatType: "private",
      }),
    ).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining("Chat vinculado correctamente"),
      redirectTo: "/settings/notifications",
    });

    expect(notificationChannelUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_type: {
            userId: "user-1",
            type: "TELEGRAM",
          },
        },
        update: {
          telegramChatId: "123456789",
          isEnabled: true,
        },
      }),
    );
    expect(writeActivityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "NotificationChannel",
        entityId: "channel-1",
        action: "TELEGRAM_RELINKED",
        userId: "user-1",
      }),
    );
    expect(logErrorMock).toHaveBeenCalledWith(
      "telegram.connect.audit",
      expect.any(Error),
      {
        chatId: "123456789",
        userId: "user-1",
      },
    );
  });
});
