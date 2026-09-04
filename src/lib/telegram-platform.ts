import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getDb } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export type TelegramDbClient = PrismaClient | Prisma.TransactionClient;
const telegramTenantStorage = new AsyncLocalStorage<TelegramDbClient>();

/**
 * Platform-global Telegram locator access. This client is only used to find a
 * linked global channel/webhook; tenant work must immediately enter an
 * explicit withTenantTransaction/withSystemTenantTransaction boundary.
 */
export function getTelegramPlatformDb(): TelegramDbClient {
  return telegramTenantStorage.getStore() ?? getDb();
}

/**
 * Keeps a webhook's tenant transaction available to the existing Telegram
 * helper graph without putting tenant state in module globals. Async-local
 * storage is isolated per request, so concurrent webhook deliveries cannot
 * reuse another organization's client.
 */
export function runTelegramTenantDb<T>(db: TelegramDbClient, callback: () => Promise<T>): Promise<T> {
  return telegramTenantStorage.run(db, callback);
}
