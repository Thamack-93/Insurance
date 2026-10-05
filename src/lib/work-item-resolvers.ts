import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { workItemPortfolioWhere } from "@/lib/portfolio-access";
import { isApplicationPrismaClient, isTenantTransactionClient, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

type WorkItemResolverDb = PrismaClient | Prisma.TransactionClient;

const workItemInclude = {
  client: true,
  policy: true,
  insurer: true,
  receipt: true,
} as const;

export type WorkItemResolverRecord = Prisma.WorkItemGetPayload<{
  include: typeof workItemInclude;
}>;

export async function findWorkItemByRouteId(
  id: string,
  organizationId: string,
  client?: WorkItemResolverDb,
  portfolioOwnerId?: string,
): Promise<WorkItemResolverRecord | null> {
  if (client && isTenantTransactionClient(client)) {
    return findWorkItemByRouteIdInTransaction(id, organizationId, client, portfolioOwnerId);
  }
  if (client && !isApplicationPrismaClient(client)) throw new Error("TENANT_TRANSACTION_REQUIRED");

  const context = await requireOrganizationContext();
  if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, (tx) =>
    findWorkItemByRouteIdInTransaction(id, organizationId, tx, portfolioOwnerId),
  );
}

async function findWorkItemByRouteIdInTransaction(
  id: string,
  organizationId: string,
  db: Prisma.TransactionClient,
  portfolioOwnerId?: string,
): Promise<WorkItemResolverRecord | null> {

  return db.workItem.findFirst({
    where: {
      organizationId,
      workItemType: "TASK",
      OR: [
        {
          sourceType: "Task",
          sourceId: id,
        },
        {
          sourceType: "WorkItem",
          sourceId: id,
        },
        {
          id,
        },
      ],
      ...(portfolioOwnerId ? { AND: [workItemPortfolioWhere(portfolioOwnerId)] } : {}),
    },
    include: workItemInclude,
  });
}
