import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  requireOrganizationContext,
  withTenantTransaction,
  type OrganizationContext,
  type TenantDb,
} from "@/lib/organization-context";

// Keep the approved boundary discoverable from the DAL entry point. The
// implementation remains in organization-context so authentication and the
// transaction-local RLS setup cannot drift into separate helpers.
export {
  withTenantTransaction,
  withSystemTenantTransaction,
  withSystemOrganizationTransaction,
} from "@/lib/organization-context";
export type { TenantDb, OrganizationContext } from "@/lib/organization-context";

/**
 * The only request-time bridge from an organization id supplied by a DAL
 * caller to the PostgreSQL tenant transaction.  The id is checked against the
 * live membership-backed context before the transaction starts; the callback
 * then receives a transaction-bound client with app.organization_id set.
 */
export async function withTenantOrganization<T>(
  organizationId: string,
  callback: (tx: TenantDb, context: OrganizationContext) => Promise<T>,
): Promise<T> {
  const context = await requireOrganizationContext();
  if (!organizationId || organizationId !== context.organizationId) {
    throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  }
  return withTenantTransaction(context, (tx) => callback(tx, context));
}

/**
 * Shared type guard for helpers that can participate in an existing tenant
 * transaction.  It intentionally accepts only Prisma transaction clients;
 * request-time code must never pass the root Prisma client into tenant DALs.
 */
export type TenantTransactionClient = Prisma.TransactionClient;
