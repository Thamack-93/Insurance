import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { addDays } from "date-fns";
import { canReactivateStaleSerialSuggestion, matchSerialRenewal, STALE_SERIAL_SUGGESTION_NOTE, type SerialRenewalMatch } from "@/lib/policy-renewal-match.logic";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type SerialRenewalCandidate = SerialRenewalMatch & {
  id: string;
  policyNumber: string;
  clientId: string;
  clientName: string;
  insurerId: string;
  insurerName: string;
  policyType: string;
  startDate: Date;
  endDate: Date;
  status: string;
  premiumAmount: number;
  currency: string;
  paymentFrequency: string;
  paymentPlan: string | null;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  notes: string | null;
};

type TargetIdentity = {
  id?: string;
  clientId: string;
  policyType: string;
  startDate: Date;
  serialNumbers: Array<string | null | undefined>;
};

export async function findSerialRenewalCandidatesForTarget(
  db: DbClient,
  organizationId: string,
  target: TargetIdentity,
  portfolioOwnerId?: string,
): Promise<SerialRenewalCandidate[]> {
  const serials = [...new Set(target.serialNumbers.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  if (!organizationId || !target.clientId || target.policyType !== "AUTO" || serials.length === 0) return [];

  const previousEndFrom = addDays(target.startDate, -45);
  const previousEndTo = addDays(target.startDate, 30);
  const sources = await db.policy.findMany({
    where: {
      organizationId,
      clientId: target.clientId,
      ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
      policyType: "AUTO",
      status: { in: ["ACTIVE", "EXPIRED"] },
      endDate: { gte: previousEndFrom, lte: previousEndTo },
      ...(target.id ? { id: { not: target.id } } : {}),
      renewals: { none: {} },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      insurer: { select: { id: true, name: true } },
      insuredAssets: { select: { serialNumber: true } },
    },
    orderBy: [{ endDate: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });

  return sources.flatMap((source) => {
    const match = matchSerialRenewal(
      { clientId: source.clientId, policyType: source.policyType, endDate: source.endDate, serialNumbers: source.insuredAssets.map((asset) => asset.serialNumber) },
      { clientId: target.clientId, policyType: target.policyType, startDate: target.startDate, serialNumbers: serials },
    );
    if (!match) return [];
    return [{
      id: source.id,
      policyNumber: source.policyNumber,
      clientId: source.clientId,
      clientName: source.client.fullName,
      insurerId: source.insurerId,
      insurerName: source.insurer.name,
      policyType: source.policyType,
      startDate: source.startDate,
      endDate: source.endDate,
      status: source.status,
      premiumAmount: Number(source.premiumAmount),
      currency: source.currency,
      paymentFrequency: source.paymentFrequency,
      paymentPlan: source.paymentPlan,
      insuredObject: source.insuredObject,
      beneficiaryInfo: source.beneficiaryInfo,
      notes: source.notes,
      ...match,
    }];
  }).sort((left, right) => right.confidence - left.confidence || Math.abs(left.gapDays) - Math.abs(right.gapDays));
}

export async function syncSerialRenewalSuggestionsForTarget(
  db: DbClient,
  organizationId: string,
  targetPolicyId: string,
) {
  const target = await db.policy.findFirst({
    where: { id: targetPolicyId, organizationId, policyType: "AUTO", status: "ACTIVE", renewedFromPolicyId: null },
    select: {
      id: true,
      clientId: true,
      policyType: true,
      startDate: true,
      insuredAssets: { select: { serialNumber: true } },
    },
  });
  if (!target) return 0;

  const candidates = await findSerialRenewalCandidatesForTarget(db, organizationId, {
    id: target.id,
    clientId: target.clientId,
    policyType: target.policyType,
    startDate: target.startDate,
    serialNumbers: target.insuredAssets.map((asset) => asset.serialNumber),
  });

  const candidateIds = candidates.map((candidate) => candidate.id);
  await db.policyRenewalSuggestion.updateMany({
    where: {
      organizationId,
      targetPolicyId: target.id,
      status: "PENDING",
      reason: { startsWith: "Misma serie/VIN" },
      ...(candidateIds.length ? { sourcePolicyId: { notIn: candidateIds } } : {}),
    },
    data: {
      status: "DISMISSED",
      reviewedAt: new Date(),
      resolutionNote: "La coincidencia por serie ya no cumple los criterios actuales.",
    },
  });

  let createdOrUpdated = 0;
  for (const candidate of candidates) {
    const existing = await db.policyRenewalSuggestion.findUnique({
      where: {
        organizationId_sourcePolicyId_targetPolicyId: {
          organizationId,
          sourcePolicyId: candidate.id,
          targetPolicyId: target.id,
        },
      },
      select: { id: true, status: true, resolutionNote: true },
    });
    const canReactivate = existing ? canReactivateStaleSerialSuggestion(existing.status, existing.resolutionNote) : false;
    if (existing && existing.status !== "PENDING" && !canReactivate) continue;

    await db.policyRenewalSuggestion.upsert({
      where: {
        organizationId_sourcePolicyId_targetPolicyId: {
          organizationId,
          sourcePolicyId: candidate.id,
          targetPolicyId: target.id,
        },
      },
      update: {
        confidence: candidate.confidence,
        reason: candidate.reason,
        status: "PENDING",
        ...(canReactivate ? { reviewedAt: null, reviewedById: null, resolutionNote: null } : {}),
      },
      create: {
        organizationId,
        sourcePolicyId: candidate.id,
        targetPolicyId: target.id,
        confidence: candidate.confidence,
        reason: candidate.reason,
        status: "PENDING",
      },
    });
    createdOrUpdated += 1;
  }
  return createdOrUpdated;
}

export async function syncSerialRenewalSuggestionsForPortfolio(
  db: DbClient,
  organizationId: string,
  portfolioOwnerId?: string,
) {
  const targets = await db.policy.findMany({
    where: {
      organizationId,
      policyType: "AUTO",
      status: "ACTIVE",
      renewedFromPolicyId: null,
      startDate: { gte: addDays(new Date(), -120) },
      ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
    },
    select: {
      id: true,
      clientId: true,
      policyType: true,
      startDate: true,
      insuredAssets: { select: { serialNumber: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  if (targets.length === 0) return 0;

  const targetIds = targets.map((target) => target.id);
  const clientIds = [...new Set(targets.map((target) => target.clientId))];
  const sources = await db.policy.findMany({
    where: {
      organizationId,
      clientId: { in: clientIds },
      ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
      policyType: "AUTO",
      status: { in: ["ACTIVE", "EXPIRED"] },
      endDate: {
        gte: addDays(targets[0].startDate, -45),
        lte: addDays(targets[targets.length - 1].startDate, 30),
      },
      renewals: { none: {} },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      insurer: { select: { id: true, name: true } },
      insuredAssets: { select: { serialNumber: true } },
    },
    orderBy: [{ endDate: "desc" }, { updatedAt: "desc" }],
  });
  const sourcesByClient = new Map<string, typeof sources>();
  for (const source of sources) {
    const clientSources = sourcesByClient.get(source.clientId) ?? [];
    clientSources.push(source);
    sourcesByClient.set(source.clientId, clientSources);
  }

  const existingSuggestions = await db.policyRenewalSuggestion.findMany({
    where: {
      organizationId,
      targetPolicyId: { in: targetIds },
      reason: { startsWith: "Misma serie/VIN" },
    },
    select: { id: true, sourcePolicyId: true, targetPolicyId: true, status: true, resolutionNote: true },
  });
  const existingByPair = new Map(existingSuggestions.map((suggestion) => [
    `${suggestion.sourcePolicyId}:${suggestion.targetPolicyId}`,
    suggestion,
  ]));

  const candidateTargetIds = new Set<string>();
  const desiredPairs = new Set<string>();
  const toCreate: Array<{
    organizationId: string;
    sourcePolicyId: string;
    targetPolicyId: string;
    confidence: number;
    reason: string;
    status: "PENDING";
  }> = [];
  const toReactivate: Array<{ id: string; confidence: number; reason: string }> = [];
  for (const target of targets) {
    candidateTargetIds.add(target.id);
    const targetSerialNumbers = target.insuredAssets.map((asset) => asset.serialNumber);
    for (const source of sourcesByClient.get(target.clientId) ?? []) {
      if (source.id === target.id) continue;
      const match = matchSerialRenewal(
        { clientId: source.clientId, policyType: source.policyType, endDate: source.endDate, serialNumbers: source.insuredAssets.map((asset) => asset.serialNumber) },
        { clientId: target.clientId, policyType: target.policyType, startDate: target.startDate, serialNumbers: targetSerialNumbers },
      );
      if (!match) continue;
      const pairKey = `${source.id}:${target.id}`;
      desiredPairs.add(pairKey);
      const existing = existingByPair.get(pairKey);
      if (existing) {
        if (canReactivateStaleSerialSuggestion(existing.status, existing.resolutionNote)) {
          toReactivate.push({ id: existing.id, confidence: match.confidence, reason: match.reason });
        }
        continue;
      }
      toCreate.push({
        organizationId,
        sourcePolicyId: source.id,
        targetPolicyId: target.id,
        confidence: match.confidence,
        reason: match.reason,
        status: "PENDING",
      });
    }
  }

  const staleIds = existingSuggestions
    .filter((suggestion) => suggestion.status === "PENDING"
      && suggestion.targetPolicyId
      && candidateTargetIds.has(suggestion.targetPolicyId)
      && !desiredPairs.has(`${suggestion.sourcePolicyId}:${suggestion.targetPolicyId}`))
    .map((suggestion) => suggestion.id);
  if (staleIds.length) {
    await db.policyRenewalSuggestion.updateMany({
      where: { organizationId, id: { in: staleIds }, status: "PENDING" },
      data: {
        status: "DISMISSED",
        reviewedAt: new Date(),
        resolutionNote: STALE_SERIAL_SUGGESTION_NOTE,
      },
    });
  }
  if (toReactivate.length) {
    for (let offset = 0; offset < toReactivate.length; offset += 1_000) {
      const batch = toReactivate.slice(offset, offset + 1_000);
      const ids = batch.map(({ id }) => id);
      const confidenceCases = Prisma.join(batch.map(({ id, confidence }) => Prisma.sql`WHEN ${id} THEN ${confidence}`), " ");
      const reasonCases = Prisma.join(batch.map(({ id, reason }) => Prisma.sql`WHEN ${id} THEN ${reason}`), " ");
      await db.$executeRaw(Prisma.sql`
        UPDATE "PolicyRenewalSuggestion"
        SET "confidence" = CASE "id" ${confidenceCases} ELSE "confidence" END,
            "reason" = CASE "id" ${reasonCases} ELSE "reason" END,
            "status" = 'PENDING',
            "reviewedAt" = NULL,
            "reviewedById" = NULL,
            "resolutionNote" = NULL,
            "updatedAt" = NOW()
        WHERE "organizationId" = ${organizationId}
          AND "id" IN (${Prisma.join(ids)})
          AND "status" = 'DISMISSED'
          AND "resolutionNote" = ${STALE_SERIAL_SUGGESTION_NOTE}
      `);
    }
  }
  if (toCreate.length) {
    await db.policyRenewalSuggestion.createMany({ data: toCreate, skipDuplicates: true });
  }
  return toCreate.length + toReactivate.length;
}
