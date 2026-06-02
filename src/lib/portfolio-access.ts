import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AuthError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

type PortfolioUser = {
  id: string;
  role: string;
};

export async function requirePortfolioUser(): Promise<PortfolioUser> {
  const user = await requireUser();
  return { id: user.id, role: user.role };
}

export function clientPortfolioWhere(userId: string): Prisma.ClientWhereInput {
  return { portfolioOwnerId: userId };
}

export function policyPortfolioWhere(userId: string): Prisma.PolicyWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function receiptPortfolioWhere(userId: string): Prisma.ReceiptWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function paymentPortfolioWhere(userId: string): Prisma.PaymentWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function commissionPortfolioWhere(userId: string): Prisma.CommissionWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function claimPortfolioWhere(userId: string): Prisma.ClaimWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function quotePortfolioWhere(userId: string): Prisma.QuoteWhereInput {
  return { client: clientPortfolioWhere(userId) };
}

export function documentPortfolioWhere(userId: string): Prisma.DocumentWhereInput {
  return {
    OR: [
      { client: clientPortfolioWhere(userId) },
      { policy: policyPortfolioWhere(userId) },
      { receipt: receiptPortfolioWhere(userId) },
      { claim: claimPortfolioWhere(userId) },
      { quote: quotePortfolioWhere(userId) },
    ],
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

export async function assertClientPortfolioAccess(clientId: string, userId: string) {
  const db = getDb();
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
  const policy = await db.policy.findFirst({
    where: { id: policyId, ...policyPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!policy) {
    throw new AuthError("No tienes acceso a esta póliza.", 403);
  }
}

export async function assertReceiptPortfolioAccess(receiptId: string, userId: string) {
  const db = getDb();
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, ...receiptPortfolioWhere(userId) },
    select: { id: true },
  });

  if (!receipt) {
    throw new AuthError("No tienes acceso a este recibo.", 403);
  }
}

