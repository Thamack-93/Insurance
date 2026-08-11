import { getBaseDb, resetBaseDb } from "@/lib/db-base";
import { assertDeploymentDatabaseSafety, resetDeploymentDatabaseSafetyCache } from "@/lib/deployment-db-safety";
import type { PrismaClient } from "@/generated/prisma/client";

const MUTATION_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

function createGuardedClient(): PrismaClient {
  const extended = getBaseDb().$extends({
    name: "policydesk-deployment-database-safety",
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (MUTATION_OPERATIONS.has(operation)) await assertDeploymentDatabaseSafety();
          return query(args);
        },
      },
    },
  });
  // Prisma's extension type intentionally omits a few client-only members even
  // though this runtime client remains API-compatible for existing consumers.
  // Keep the infrastructure detail from widening every domain DbClient union.
  return extended as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { guardedPrisma?: PrismaClient };

export function getDb() {
  if (!globalForPrisma.guardedPrisma) globalForPrisma.guardedPrisma = createGuardedClient();
  return globalForPrisma.guardedPrisma;
}

export async function resetDb() {
  globalForPrisma.guardedPrisma = undefined;
  resetDeploymentDatabaseSafetyCache();
  await resetBaseDb();
}
