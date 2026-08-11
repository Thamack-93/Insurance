import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { assertDeploymentDatabaseSafety } from "@/lib/deployment-db-safety";

type RawSqlClient = PrismaClient | Prisma.TransactionClient;

export async function deploymentSafeQueryRaw<T>(client: RawSqlClient, query: Prisma.Sql): Promise<T> {
  await assertDeploymentDatabaseSafety();
  return client.$queryRaw<T>(query);
}

export async function deploymentSafeExecuteRaw(client: RawSqlClient, query: Prisma.Sql): Promise<number> {
  await assertDeploymentDatabaseSafety();
  return client.$executeRaw(query);
}
