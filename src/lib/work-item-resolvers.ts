import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { workItemPortfolioWhere } from "@/lib/portfolio-access";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

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
  if (!client || typeof (client as PrismaClient).$transaction === "function") {
    const context = await requireOrganizationContext();
    if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    return withTenantTransaction(context, (tx) => findWorkItemByRouteId(id, organizationId, tx, portfolioOwnerId));
  }
  const db = client as Prisma.TransactionClient;

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
          id,
        },
      ],
      ...(portfolioOwnerId ? { AND: [workItemPortfolioWhere(portfolioOwnerId)] } : {}),
    },
    include: workItemInclude,
  });
}
