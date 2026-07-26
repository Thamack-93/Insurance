import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const notificationChannelUpsert = vi.hoisted(() => vi.fn());
const notificationChannelFindUnique = vi.hoisted(() => vi.fn());
const notificationPreferenceUpsert = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      notificationChannel: {
        upsert: notificationChannelUpsert,
        findUnique: notificationChannelFindUnique,
      },
      notificationPreference: {
        upsert: notificationPreferenceUpsert,
      },
    }),
  };
});

vi.mock("@/lib/logger", () => {
  return {
    logError: logErrorMock,
  };
});

import { getTelegramChannelStateForUser } from "./telegram";

describe("telegram channel state", () => {
  beforeEach(() => {
    notificationChannelUpsert.mockReset();
    notificationChannelFindUnique.mockReset();
    notificationPreferenceUpsert.mockReset();
    logErrorMock.mockReset();
  });

  it("returns the channel when Telegram state loads successfully", async () => {
    const channel = {
      id: "channel-1",
      userId: "user-1",
      type: "TELEGRAM",
      telegramChatId: "123456789",
      isEnabled: true,
      telegramMutationsEnabled: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    notificationChannelUpsert.mockResolvedValue(channel);
    notificationChannelFindUnique.mockResolvedValue(channel);

    await expect(getTelegramChannelStateForUser("user-1")).resolves.toMatchObject({
      id: "channel-1",
      telegramChatId: "123456789",
      isEnabled: true,
    });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("falls back to a disconnected state when loading Telegram state fails", async () => {
    notificationChannelUpsert.mockRejectedValue(new Error("database unavailable"));

    await expect(getTelegramChannelStateForUser("user-1")).resolves.toMatchObject({
      userId: "user-1",
      type: "TELEGRAM",
      telegramChatId: null,
      isEnabled: false,
      telegramMutationsEnabled: false,
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      "telegram.getTelegramChannelStateForUser",
      expect.any(Error),
      { userId: "user-1" },
    );
  });
});
