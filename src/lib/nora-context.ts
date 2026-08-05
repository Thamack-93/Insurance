import "server-only";

import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  claimOperationalWhere,
  clientOperationalWhere,
  endorsementOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";
import type { OrganizationContext } from "@/lib/organization-context";

export const noraEntityTypeSchema = z.enum(["client", "policy", "receipt", "workItem", "claim", "endorsement"]);
export const noraContextRefSchema = z.object({ type: noraEntityTypeSchema, id: z.string().min(1).max(100) });

export type NoraEntityType = z.infer<typeof noraEntityTypeSchema>;
export type NoraContextRef = z.infer<typeof noraContextRefSchema>;

export async function resolveAuthorizedNoraContext(
  ref: NoraContextRef,
  scope:
    | (Pick<OrganizationContext, "organizationId" | "membershipRole"> & { portfolioOwnerId?: string })
    | string
    | undefined = undefined,
) {
  const db = getDb();
  const portfolioOwnerId = typeof scope === "string" ? scope : scope?.membershipRole === "AGENT" ? scope.portfolioOwnerId : undefined;
  const organizationId = typeof scope === "string" ? undefined : scope?.organizationId;

  switch (ref.type) {
    case "client": {
      const entity = await db.client.findFirst({ where: { AND: [{ id: ref.id }, clientOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, fullName: true } });
      return entity ? { ...ref, label: entity.fullName } : null;
    }
    case "policy": {
      const entity = await db.policy.findFirst({ where: { AND: [{ id: ref.id }, policyOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, policyNumber: true } });
      return entity ? { ...ref, label: entity.policyNumber } : null;
    }
    case "receipt": {
      const entity = await db.receipt.findFirst({ where: { AND: [{ id: ref.id }, receiptOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, receiptNumber: true } });
      return entity ? { ...ref, label: entity.receiptNumber } : null;
    }
    case "workItem": {
      const entity = await db.workItem.findFirst({ where: { AND: [{ id: ref.id }, workItemOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, title: true } });
      return entity ? { ...ref, label: entity.title } : null;
    }
    case "claim": {
      const entity = await db.claim.findFirst({ where: { AND: [{ id: ref.id }, claimOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, folio: true } });
      return entity ? { ...ref, label: entity.folio } : null;
    }
    case "endorsement": {
      const entity = await db.policyEndorsement.findFirst({ where: { AND: [{ id: ref.id }, endorsementOperationalWhere(portfolioOwnerId, organizationId)] }, select: { id: true, endorsementNumber: true } });
      return entity ? { ...ref, label: entity.endorsementNumber } : null;
    }
  }
}
