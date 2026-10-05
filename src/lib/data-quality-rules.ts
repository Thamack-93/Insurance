import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { isTenantTransactionClient, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

export type DataQualityRuleCategory = "PAYMENTS" | "RENOVATIONS" | "LEDGER" | "RISKS";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function withSuppressionRuleTransaction<T>(
  organizationId: string,
  client: DbClient | undefined,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (client && isTenantTransactionClient(client)) return callback(client);
  if (client && client !== getDb()) throw new Error("TENANT_TRANSACTION_REQUIRED");

  const context = await requireOrganizationContext();
  if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, callback);
}

export type SuppressionCriteria = Record<string, string>;

export type SuppressionRuleSnapshot = {
  id: string;
  category: string;
  issueCode: string;
  criteriaJson: string;
  active: boolean;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeCriteria(criteria: SuppressionCriteria) {
  return Object.fromEntries(Object.entries(criteria).sort(([left], [right]) => left.localeCompare(right)));
}

export function stringifySuppressionCriteria(criteria: SuppressionCriteria) {
  return JSON.stringify(normalizeCriteria(criteria));
}

export function parseSuppressionCriteria(criteriaJson: string): SuppressionCriteria {
  try {
    const parsed = JSON.parse(criteriaJson) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

export function matchesSuppressionCriteria(criteriaJson: string, fields: Record<string, unknown>) {
  const criteria = parseSuppressionCriteria(criteriaJson);
  return Object.entries(criteria).every(([key, expected]) => String(fields[key] ?? "") === expected);
}

export async function getActiveSuppressionRules(organizationId: string, client?: DbClient): Promise<SuppressionRuleSnapshot[]> {
  return withSuppressionRuleTransaction(organizationId, client, async (db) => {
  const rules = await db.dataQualitySuppressionRule.findMany({
    where: {
      organizationId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ category: "asc" }, { issueCode: "asc" }, { createdAt: "desc" }],
  });

  return rules.map((rule) => ({
    id: rule.id,
    category: rule.category,
    issueCode: rule.issueCode,
    criteriaJson: rule.criteriaJson,
    active: rule.active,
    reason: rule.reason,
    expiresAt: rule.expiresAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }));
  });
}

export async function findMatchingSuppressionRule(
  input: {
    category: DataQualityRuleCategory;
    issueCode: string;
    fields: Record<string, unknown>;
  },
  organizationId: string,
  client?: DbClient,
): Promise<SuppressionRuleSnapshot | null> {
  return withSuppressionRuleTransaction(organizationId, client, async (db) => {
  const rules = await db.dataQualitySuppressionRule.findMany({
    where: {
      organizationId,
      category: input.category,
      issueCode: input.issueCode,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const match = rules.find((rule) => matchesSuppressionCriteria(rule.criteriaJson, input.fields));
  if (!match) return null;

  return {
    id: match.id,
    category: match.category,
    issueCode: match.issueCode,
    criteriaJson: match.criteriaJson,
    active: match.active,
    reason: match.reason,
    expiresAt: match.expiresAt,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
  });
}

export async function upsertSuppressionRule(
  input: {
    category: DataQualityRuleCategory;
    issueCode: string;
    criteria: SuppressionCriteria;
    reason?: string | null;
    expiresAt?: Date | null;
    actorId: string;
    organizationId: string;
  },
  client?: DbClient,
): Promise<SuppressionRuleSnapshot> {
  return withSuppressionRuleTransaction(input.organizationId, client, async (db) => {
  const criteriaJson = stringifySuppressionCriteria(input.criteria);
  const rule = await db.dataQualitySuppressionRule.upsert({
    where: {
      organizationId_category_issueCode_criteriaJson: {
        organizationId: input.organizationId,
        category: input.category,
        issueCode: input.issueCode,
        criteriaJson,
      },
    },
    update: {
      active: true,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      reviewedAt: new Date(),
      reviewedById: input.actorId,
    },
    create: {
      organizationId: input.organizationId,
      category: input.category,
      issueCode: input.issueCode,
      criteriaJson,
      active: true,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      reviewedAt: new Date(),
      reviewedById: input.actorId,
      createdById: input.actorId,
    },
  });

  return {
    id: rule.id,
    category: rule.category,
    issueCode: rule.issueCode,
    criteriaJson: rule.criteriaJson,
    active: rule.active,
    reason: rule.reason,
    expiresAt: rule.expiresAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
  });
}

export async function deactivateSuppressionRule(ruleId: string, organizationId: string, actorId: string, client?: DbClient): Promise<SuppressionRuleSnapshot> {
  return withSuppressionRuleTransaction(organizationId, client, async (db) => {
  const rule = await db.dataQualitySuppressionRule.findFirstOrThrow({
    where: { id: ruleId, organizationId },
  });
  await db.dataQualitySuppressionRule.updateMany({
    where: { id: ruleId, organizationId },
    data: {
      active: false,
      reviewedAt: new Date(),
      reviewedById: actorId,
    },
  });

  return {
    id: rule.id,
    category: rule.category,
    issueCode: rule.issueCode,
    criteriaJson: rule.criteriaJson,
    active: false,
    reason: rule.reason,
    expiresAt: rule.expiresAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  } satisfies SuppressionRuleSnapshot;
  });
}
