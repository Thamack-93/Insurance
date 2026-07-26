export type WorkItemNavigationInput = {
  id: string;
  sourceType?: string | null;
  sourceId?: string | null;
  workItemType?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  clientId?: string | null;
  policyId?: string | null;
  receiptId?: string | null;
};

/**
 * Resolves the most useful existing detail route for a queue entry. WorkItem is
 * an operational envelope and not every source has a Task-compatible route.
 */
export function getWorkItemHref(item: WorkItemNavigationInput) {
  const sourceType = item.sourceType?.toLowerCase();
  const entityType = item.entityType?.toLowerCase();

  if ((sourceType === "renewal" || entityType === "policy") && item.policyId) {
    return `/policies/${item.policyId}`;
  }
  if (entityType === "claim" && item.entityId) return `/claims/${item.entityId}`;
  if (entityType === "receipt" && item.receiptId) return `/receipts/${item.receiptId}`;

  if (item.workItemType === "TASK") {
    const routeId = sourceType === "task" && item.sourceId ? item.sourceId : item.id;
    return `/tasks/${routeId}`;
  }

  if (item.receiptId) return `/receipts/${item.receiptId}`;
  if (item.policyId) return `/policies/${item.policyId}`;
  if (item.clientId) return `/clients/${item.clientId}`;
  return "/operations?view=pending";
}
