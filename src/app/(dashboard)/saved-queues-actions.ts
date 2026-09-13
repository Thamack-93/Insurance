"use server";

import { deleteSavedQueue, listSavedQueues, saveQueue } from "@/lib/saved-queues";
import { requireOrganizationContext } from "@/lib/organization-context";

export async function listSavedQueueAction(route?: "operations" | "renewal-board" | "receipts" | "commissions") {
  await requireOrganizationContext();
  return listSavedQueues(route);
}

export async function saveSavedQueueAction(name: string, config: unknown, id?: string) {
  await requireOrganizationContext();
  return saveQueue(name, config, id);
}

export async function deleteSavedQueueAction(id: string) {
  await requireOrganizationContext();
  return deleteSavedQueue(id);
}
