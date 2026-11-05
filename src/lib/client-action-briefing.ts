import "server-only";

import { withTenantTransaction, type OrganizationContext, type TenantDb } from "@/lib/organization-context";
import type { PortfolioReadScope } from "@/lib/portfolio-access";
import { claimOperationalWhere, receiptOperationalWhere } from "@/lib/portfolio-access";
import { getActivityForEntity } from "@/lib/activity-log";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import { businessAddDays, businessEndOfDay, businessToday } from "@/lib/business-dates";
import {
  buildClientActionOverview,
  buildClientActions,
  type ClientAction,
  type ClientActionClaim,
  type ClientActionData,
  type ClientActionOverviewItem,
  type ClientActionReceipt,
} from "@/lib/client-action-briefing.logic";

type AuthorizedPortfolioScope = PortfolioReadScope & { context: OrganizationContext };

async function readClientActionData(
  scope: AuthorizedPortfolioScope,
  db: TenantDb,
  clientId?: string,
): Promise<ClientActionData> {
  if (scope.organizationId !== scope.context.organizationId) {
    throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  }

  const today = businessToday();
  const in60Days = businessAddDays(today, 60);
  const inSevenDays = businessAddDays(today, 7);
  const recentActivity = clientId
    ? getActivityForEntity("Client", clientId, 3, scope.organizationId, db)
    : Promise.resolve([]);

  const [renewals, receipts, workItems, claims, activity] = await Promise.all([
    loadEligibleRenewalPolicies(
      { endDate: { lte: businessEndOfDay(in60Days) }, ...(clientId ? { clientId } : {}) },
      scope.portfolioOwnerId,
      scope.organizationId,
      db,
    ),
    db.receipt.findMany({
      where: {
        ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        ...(clientId ? { clientId } : {}),
        status: { in: ["PENDING", "OVERDUE"] },
        dueDate: { lte: businessEndOfDay(inSevenDays) },
      },
      select: {
        id: true,
        clientId: true,
        client: { select: { fullName: true } },
        receiptNumber: true,
        dueDate: true,
        amount: true,
        currency: true,
        status: true,
        policyId: true,
        policy: { select: { policyNumber: true } },
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
    getWorkItems({
      organizationId: scope.organizationId,
      portfolioOwnerId: scope.portfolioOwnerId,
      clientId,
      statuses: OPEN_WORK_ITEM_STATUSES,
      workItemTypes: ["TASK"],
    }, db),
    db.claim.findMany({
      where: {
        ...claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        ...(clientId ? { clientId } : {}),
        status: { notIn: ["RESOLVED", "CANCELLED"] },
      },
      select: {
        id: true,
        clientId: true,
        client: { select: { fullName: true } },
        folio: true,
        claimType: true,
        status: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { reportedDate: "desc" }, { id: "asc" }],
    }),
    recentActivity,
  ]);

  return {
    today,
    receipts: receipts as ClientActionReceipt[],
    renewals: renewals.map((policy) => ({
      policyId: policy.id,
      clientId: policy.clientId,
      clientName: policy.client.fullName,
      policyNumber: policy.policyNumber,
      endDate: policy.endDate,
    })),
    workItems,
    claims: claims as ClientActionClaim[],
    activity,
  };
}

export async function getClientActionBriefingFromDb(
  scope: AuthorizedPortfolioScope,
  db: TenantDb,
  clientId: string,
): Promise<ClientAction[]> {
  const data = await readClientActionData(scope, db, clientId);
  return buildClientActions(data);
}

export async function getClientActionOverview(
  scope: AuthorizedPortfolioScope,
): Promise<ClientActionOverviewItem[]> {
  return withTenantTransaction(scope.context, async (db) => {
    const data = await readClientActionData(scope, db);
    return buildClientActionOverview(buildClientActions(data));
  });
}
