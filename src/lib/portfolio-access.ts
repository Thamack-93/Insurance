import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AuthError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

type PortfolioUser = {
  id: string;
  role: string;
};

export type PortfolioReadScope = PortfolioUser & {
  portfolioOwnerId?: string;
};

export async function requirePortfolioUser(): Promise<PortfolioUser> {
  const user = await requireUser();
  return { id: user.id, role: user.role };
}

export async function requirePortfolioReadScope(): Promise<PortfolioReadScope> {
  const user = await requirePortfolioUser();
  return { ...user, portfolioOwnerId: getPortfolioOwnerIdForRead(user) };
}

export function getPortfolioOwnerIdForRead(user: PortfolioUser): string | undefined {
  return user.role === "ADMIN" ? undefined : user.id;
}

export function clientPortfolioWhere(userId: string): Prisma.ClientWhereInput {
  return { portfolioOwnerId: userId };
}

export function clientOperationalWhere(portfolioOwnerId?: string): Prisma.ClientWhereInput {
  return portfolioOwnerId ? clientPortfolioWhere(portfolioOwnerId) : {};
}

export function policyPortfolioWhere(userId: string): Prisma.PolicyWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function policyOperationalWhere(portfolioOwnerId?: string): Prisma.PolicyWhereInput {
  return portfolioOwnerId ? policyPortfolioWhere(portfolioOwnerId) : {};
}

export function endorsementPortfolioWhere(userId: string): Prisma.PolicyEndorsementWhereInput {
  return { policy: policyPortfolioWhere(userId) };
}

export function endorsementOperationalWhere(portfolioOwnerId?: string): Prisma.PolicyEndorsementWhereInput {
  return portfolioOwnerId ? endorsementPortfolioWhere(portfolioOwnerId) : {};
}

export function receiptPortfolioWhere(userId: string): Prisma.ReceiptWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function receiptOperationalWhere(portfolioOwnerId?: string): Prisma.ReceiptWhereInput {
  return portfolioOwnerId ? receiptPortfolioWhere(portfolioOwnerId) : {};
}

export function paymentPortfolioWhere(userId: string): Prisma.PaymentWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function paymentOperationalWhere(portfolioOwnerId?: string): Prisma.PaymentWhereInput {
  return portfolioOwnerId ? paymentPortfolioWhere(portfolioOwnerId) : {};
}

export function commissionPortfolioWhere(userId: string): Prisma.CommissionWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function commissionOperationalWhere(portfolioOwnerId?: string): Prisma.CommissionWhereInput {
  return portfolioOwnerId ? commissionPortfolioWhere(portfolioOwnerId) : {};
}

export function claimPortfolioWhere(userId: string): Prisma.ClaimWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function claimOperationalWhere(portfolioOwnerId?: string): Prisma.ClaimWhereInput {
  return portfolioOwnerId ? claimPortfolioWhere(portfolioOwnerId) : {};
}

export function quotePortfolioWhere(userId: string): Prisma.QuoteWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function quoteOperationalWhere(portfolioOwnerId?: string): Prisma.QuoteWhereInput {
  return portfolioOwnerId ? quotePortfolioWhere(portfolioOwnerId) : {};
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

export function documentOperationalWhere(portfolioOwnerId?: string): Prisma.DocumentWhereInput {
  return portfolioOwnerId ? documentPortfolioWhere(portfolioOwnerId) : {};
}

export function workItemPortfolioWhere(userId: string): Prisma.WorkItemWhereInput {
  return {
    OR: [
      { client: clientPortfolioWhere(userId) },
      { clientId: null, assignedToId: userId },
    ],
  };
}

export function workItemOperationalWhere(portfolioOwnerId?: string): Prisma.WorkItemWhereInput {
  return portfolioOwnerId ? workItemPortfolioWhere(portfolioOwnerId) : {};
}

export async function assertClientPortfolioAccess(clientId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const client = await db.client.findFirst({
    where: { id: clientId, ...clientPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!client) {
    throw new AuthError("No tienes acceso a esta cartera.", 403);
  }
}

export async function assertPolicyPortfolioAccess(policyId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const policy = await db.policy.findFirst({
    where: { id: policyId, ...policyPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!policy) {
    throw new AuthError("No tienes acceso a esta póliza.", 403);
  }
}

export async function assertEndorsementPortfolioAccess(endorsementId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const endorsement = await db.policyEndorsement.findFirst({
    where: { id: endorsementId, ...endorsementPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!endorsement) {
    throw new AuthError("No tienes acceso a este endoso.", 403);
  }
}

export async function assertReceiptPortfolioAccess(receiptId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, ...receiptPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!receipt) {
    throw new AuthError("No tienes acceso a este recibo.", 403);
  }
}

export async function assertQuotePortfolioAccess(quoteId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const quote = await db.quote.findFirst({
    where: { id: quoteId, ...quotePortfolioWhere(userId) },
    select: { id: true },
  });

  if (!quote) {
    throw new AuthError("No tienes acceso a esta cotización.", 403);
  }
}

export async function assertClaimPortfolioAccess(claimId: string, userId: string) {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "ADMIN") return;
  const claim = await db.claim.findFirst({
    where: { id: claimId, ...claimPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!claim) {
    throw new AuthError("No tienes acceso a este siniestro.", 403);
  }
}
