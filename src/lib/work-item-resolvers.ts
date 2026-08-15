import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { workItemPortfolioWhere } from "@/lib/portfolio-access";

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
  const db = client ?? getDb();

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
