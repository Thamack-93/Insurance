import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AuthError, requireOrganizationContextOrRedirect } from "@/lib/auth";
import { requireOrganizationContext, type OrganizationContext, withTenantTransaction } from "@/lib/organization-context";

export type PortfolioReadScope = {
  id: string;
  role: string;
  portfolioOwnerId?: string;
  organizationId: string;
  membershipRole: string;
};

function portfolioReadScope(context: OrganizationContext): PortfolioReadScope & { context: OrganizationContext } {
  return {
    id: context.userId,
    role: context.membershipRole,
    portfolioOwnerId: context.membershipRole === "AGENT" ? context.userId : undefined,
    organizationId: context.organizationId,
    membershipRole: context.membershipRole,
    context,
  };
}

export async function requireOrganizationPortfolioReadScope(): Promise<PortfolioReadScope & { context: OrganizationContext }> {
  return portfolioReadScope(await requireOrganizationContext());
}

/**
 * Page-oriented variant for read routes. Expected tenant/session failures
 * must use the canonical navigation destinations instead of reaching a
 * generic route error boundary.
 */
export async function requireOrganizationPortfolioReadScopeOrRedirect(): Promise<PortfolioReadScope & { context: OrganizationContext }> {
  return portfolioReadScope(await requireOrganizationContextOrRedirect());
}

export function clientPortfolioWhere(userId: string): Prisma.ClientWhereInput {
  return { portfolioOwnerId: userId };
}

export function clientOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.ClientWhereInput {
  return { organizationId, ...(portfolioOwnerId ? clientPortfolioWhere(portfolioOwnerId) : {}) };
}

export function policyPortfolioWhere(userId: string): Prisma.PolicyWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function policyOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.PolicyWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function endorsementPortfolioWhere(userId: string): Prisma.PolicyEndorsementWhereInput {
  return { policy: policyPortfolioWhere(userId) };
}

export function endorsementOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.PolicyEndorsementWhereInput {
  return {
    organizationId,
    policy: { organizationId, client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) } },
  };
}

export function receiptPortfolioWhere(userId: string): Prisma.ReceiptWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function receiptOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.ReceiptWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function paymentPortfolioWhere(userId: string): Prisma.PaymentWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function paymentOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.PaymentWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function commissionPortfolioWhere(userId: string): Prisma.CommissionWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function commissionOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.CommissionWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function claimPortfolioWhere(userId: string): Prisma.ClaimWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function claimOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.ClaimWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function quotePortfolioWhere(userId: string): Prisma.QuoteWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function quoteOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.QuoteWhereInput {
  return {
    organizationId,
    client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
  };
}

export function documentPortfolioWhere(userId: string): Prisma.DocumentWhereInput {
  return {
    OR: [
      { client: clientPortfolioWhere(userId) },
      { policy: policyPortfolioWhere(userId) },
      { endorsement: endorsementPortfolioWhere(userId) },
      { receipt: receiptPortfolioWhere(userId) },
      { claim: claimPortfolioWhere(userId) },
      { quote: quotePortfolioWhere(userId) },
      // Legacy Task-linked documents are intentionally hidden from agent
      // scopes until they are explicitly reattached to a WorkItem.
      {
        AND: [
          { createdById: userId },
          { clientId: null },
          { policyId: null },
          { endorsementId: null },
          { receiptId: null },
          { taskId: null },
          { claimId: null },
          { quoteId: null },
        ],
      },
    ],
  };
}

export function documentOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.DocumentWhereInput {
  return {
    organizationId,
    ...(portfolioOwnerId ? documentPortfolioWhere(portfolioOwnerId) : {}),
  };
}

export function workItemPortfolioWhere(userId: string): Prisma.WorkItemWhereInput {
  return {
    OR: [
      { client: clientPortfolioWhere(userId) },
      { clientId: null, assignedToId: userId },
    ],
  };
}

export function workItemOperationalWhere(portfolioOwnerId: string | undefined, organizationId: string): Prisma.WorkItemWhereInput {
  return {
    organizationId,
    ...(portfolioOwnerId ? workItemPortfolioWhere(portfolioOwnerId) : {}),
  };
}

export async function assertClientOrganizationAccess(clientId: string, context: OrganizationContext) {
  const client = await withTenantTransaction(context, (tx) => tx.client.findFirst({
    where: {
      id: clientId,
      organizationId: context.organizationId,
      ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}),
    },
    select: { id: true },
  }));
  if (!client) throw new AuthError("No tienes acceso a este cliente.", 403);
}

export async function assertPolicyOrganizationAccess(policyId: string, context: OrganizationContext) {
  const policy = await withTenantTransaction(context, (tx) => tx.policy.findFirst({
    where: {
      id: policyId,
      ...policyOperationalWhere(context.membershipRole === "AGENT" ? context.userId : undefined, context.organizationId),
    },
    select: { id: true },
  }));
  if (!policy) throw new AuthError("No tienes acceso a esta póliza.", 403);
}

export async function assertEndorsementOrganizationAccess(endorsementId: string, context: OrganizationContext) {
  const endorsement = await withTenantTransaction(context, (tx) => tx.policyEndorsement.findFirst({
    where: {
      id: endorsementId,
      organizationId: context.organizationId,
      ...(context.membershipRole === "AGENT" ? { policy: { client: { portfolioOwnerId: context.userId } } } : {}),
    },
    select: { id: true },
  }));
  if (!endorsement) throw new AuthError("No tienes acceso a este endoso.", 403);
}
