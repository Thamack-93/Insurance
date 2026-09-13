import "server-only";

import { z } from "zod";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

const savedQueueSchema = z.object({
  route: z.enum(["operations", "renewal-board", "receipts", "commissions"]),
  search: z.string().max(200).optional(),
  filters: z.record(z.string(), z.string().max(120)).default({}),
  sort: z.string().max(120).optional(),
  dateWindow: z.enum(["today", "7d", "30d", "60d", "90d", "custom"]).optional(),
  version: z.literal(1).default(1),
});

export type SavedQueue = z.infer<typeof savedQueueSchema> & { id: string; name: string };
const keyFor = (id: string) => `savedQueue:${id}`;

export async function listSavedQueues(route?: SavedQueue["route"]) {
  const context = await requireOrganizationContext();
  return withTenantTransaction(context, async (db) => {
    const rows = await db.userPreference.findMany({ where: { userId: context.userId, key: { startsWith: "savedQueue:" } }, orderBy: { updatedAt: "desc" } });
    return rows.flatMap((row) => {
      try {
        const parsed = JSON.parse(row.value) as { name?: string; config?: unknown };
        const config = savedQueueSchema.parse(parsed.config);
        if (route && config.route !== route) return [];
        return [{ ...config, id: row.key.slice("savedQueue:".length), name: parsed.name?.trim() || "Cola guardada" }];
      } catch { return []; }
    });
  });
}

export async function saveQueue(name: string, config: unknown, id?: string) {
  const context = await requireOrganizationContext();
  const cleanName = name.trim().slice(0, 80);
  if (!cleanName) throw new Error("El nombre de la cola es requerido.");
  const parsed = savedQueueSchema.parse(config);
  return withTenantTransaction(context, async (db) => {
    const existing = await db.userPreference.count({ where: { userId: context.userId, key: { startsWith: "savedQueue:" } } });
    if (!id && existing >= 20) throw new Error("Has alcanzado el límite de 20 colas guardadas.");
    const queueId = id?.trim() || crypto.randomUUID();
    await db.userPreference.upsert({ where: { userId_key: { userId: context.userId, key: keyFor(queueId) } }, create: { userId: context.userId, key: keyFor(queueId), value: JSON.stringify({ name: cleanName, config: parsed }) }, update: { value: JSON.stringify({ name: cleanName, config: parsed }) } });
    return { id: queueId, name: cleanName, ...parsed };
  });
}

export async function deleteSavedQueue(id: string) {
  const context = await requireOrganizationContext();
  return withTenantTransaction(context, (db) => db.userPreference.deleteMany({ where: { userId: context.userId, key: keyFor(id) } }));
}
