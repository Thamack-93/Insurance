"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeActivityLog } from "@/lib/activity-log";
import { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/business-dates";
import { assertOrganizationContextInTransaction, requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";
import { BONUS_RULE_SOURCE_HASH, resolveBonusProgram } from "@/lib/bonus-rules";
import { calculateBonusProjection, decimalOrNull } from "@/lib/bonus-calculation";
import { autoFleetEligibilityFromInventory, damagePortfolioLossRatioEvidenceSchema, parseBonusEligibilityEvidence, recordBonusEvidenceReview } from "@/lib/bonus-evidence";

function parseInput(formData: FormData) {
  const programKey = String(formData.get("programKey") ?? "");
  const sellerId = String(formData.get("sellerId") ?? "");
  const year = Number(formData.get("year") ?? 2026);
  const periodNumber = Number(formData.get("periodNumber") ?? 1);
  const rule = resolveBonusProgram(programKey);
  const validPeriod = rule?.period === "QUARTERLY"
    ? Number.isInteger(periodNumber) && periodNumber >= 1 && periodNumber <= 4
    : periodNumber === 1;
  if (!rule || !sellerId || year !== 2026 || !validPeriod) {
    throw new Error("Selecciona un programa, vendedor y periodo válidos para 2026.");
  }
  const lossRatioInput = String(formData.get("damagePortfolioLossRatio") ?? "").trim();
  const lossRatioAsOf = String(formData.get("damagePortfolioLossRatioAsOf") ?? "").trim();
  const lossRatioSource = String(formData.get("damagePortfolioLossRatioSource") ?? "").trim();
  const isDamageProgram = programKey.startsWith("DAMAGE_");
  const parsedLossRatio = lossRatioInput === "" ? null : Number(lossRatioInput) / 100;
  const damageEvidence = damagePortfolioLossRatioEvidenceSchema.safeParse({
    lossRatioPercent: parsedLossRatio === null ? null : parsedLossRatio * 100,
    asOf: lossRatioAsOf || null,
    sourceReference: lossRatioSource || null,
  });
  if (isDamageProgram && !damageEvidence.success) throw new Error("Revisa el porcentaje, fecha de corte y fuente de siniestralidad de la cartera total de Daños.");
  const damagePortfolioLossRatio = isDamageProgram ? parsedLossRatio : null;
  return {
    rule, programKey, sellerId, year, periodNumber: rule.period === "QUARTERLY" ? periodNumber : 1,
    damagePortfolioLossRatio,
    damagePortfolioLossRatioAsOf: isDamageProgram ? lossRatioAsOf || null : null,
    damagePortfolioLossRatioSource: isDamageProgram ? lossRatioSource || null : null,
  };
}

// TODO(data-retention): Review the five-day period after the initial testing
// cycle. Bonus projections and approved bonus runs are all ephemeral snapshots;
// commission records are financial records and are not part of this purge.
export async function previewBonus(formData: FormData) {
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  const input = parseInput(formData);
  const runId = await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const sellerMembership = await tx.organizationMembership.findFirst({
      where: { organizationId: context.organizationId, userId: input.sellerId, active: true, organization: { status: "ACTIVE" }, user: { active: true } },
      select: { id: true },
    });
    if (!sellerMembership) throw new Error("El vendedor seleccionado no pertenece a esta organización activa.");
    const rulesJson = JSON.stringify(input.rule);
    const existingRule = await tx.bonusRuleSet.findFirst({ where: { organizationId: context.organizationId, programKey: input.programKey, sourceHash: BONUS_RULE_SOURCE_HASH, rulesJson } });
    const latestRule = existingRule ?? await tx.bonusRuleSet.findFirst({ where: { organizationId: context.organizationId, programKey: input.programKey }, orderBy: { version: "desc" } });
    const ruleSet = existingRule ?? await tx.bonusRuleSet.create({
      data: {
        organizationId: context.organizationId,
        programKey: input.programKey,
        version: (latestRule?.version ?? 0) + 1,
        effectiveStart: new Date("2026-01-01T00:00:00.000Z"),
        effectiveEnd: new Date("2026-12-31T23:59:59.999Z"),
        sourceFileName: "Cuaderno de Incentivos 2026..pdf",
        sourceHash: BONUS_RULE_SOURCE_HASH,
        rulesJson,
        createdById: context.userId,
      },
    });
    const projection = await calculateBonusProjection(tx, context.organizationId, input.rule, input);
    const periodType = input.rule.period;
    const lockRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BonusRun" WHERE "id" = (SELECT "id" FROM "BonusRun" WHERE "organizationId" = ${context.organizationId} AND "programKey" = ${input.programKey} AND "sellerId" = ${input.sellerId} AND "year" = ${input.year} AND "periodType" = ${periodType} AND "periodNumber" = ${input.periodNumber}) FOR UPDATE`);
    void lockRows;
    const existingRun = await tx.bonusRun.findFirst({
      where: { organizationId: context.organizationId, programKey: input.programKey, sellerId: input.sellerId, year: input.year, periodType, periodNumber: input.periodNumber },
      select: { id: true, status: true },
    });
    if (existingRun?.status === "APPROVED") throw new Error("Este cierre ya está aprobado y es inmutable.");
    const snapshotJson = JSON.stringify({ input, program: input.rule, projection, ruleSetId: ruleSet.id, sourceHash: BONUS_RULE_SOURCE_HASH, generatedAt: new Date().toISOString() });
    const run = existingRun
      ? await tx.bonusRun.update({
          where: { id: existingRun.id },
          data: {
            ruleSetId: ruleSet.id, status: projection.status === "READY" ? "READY" : "REVIEW",
            baseAmount: projection.baseAmount, bonusRate: decimalOrNull(projection.bonusRate === null ? null : String(projection.bonusRate)),
            bonusAmount: decimalOrNull(projection.bonusAmount), snapshotJson,
            reviewReasonsJson: JSON.stringify(projection.reviewReasons), version: { increment: 1 },
            items: { deleteMany: {}, create: projection.items.map((item) => ({
              organizationId: context.organizationId, paymentId: item.paymentId, receiptId: item.receiptId, policyId: item.policyId,
              status: item.status, currency: item.currency, paidAmount: decimalOrNull(item.paidAmount),
              netPremiumPaid: decimalOrNull(item.netPremiumPaid), eligibleAmount: decimalOrNull(item.eligibleAmount),
              conversionRate: decimalOrNull(item.conversionRate), conversionDate: item.conversionDate ? new Date(`${item.conversionDate}T00:00:00.000Z`) : null,
              reason: item.reason, evidenceJson: JSON.stringify(item.evidence),
            })) },
          }, select: { id: true },
        })
      : await tx.bonusRun.create({
          data: {
            organizationId: context.organizationId, ruleSetId: ruleSet.id, programKey: input.programKey,
            sellerId: input.sellerId, year: input.year, periodType, periodNumber: input.periodNumber,
            status: projection.status === "READY" ? "READY" : "REVIEW", baseAmount: projection.baseAmount,
            bonusRate: decimalOrNull(projection.bonusRate === null ? null : String(projection.bonusRate)),
            bonusAmount: decimalOrNull(projection.bonusAmount), snapshotJson, reviewReasonsJson: JSON.stringify(projection.reviewReasons),
            createdById: context.userId,
            items: { create: projection.items.map((item) => ({
              organizationId: context.organizationId, paymentId: item.paymentId, receiptId: item.receiptId, policyId: item.policyId,
              status: item.status, currency: item.currency, paidAmount: decimalOrNull(item.paidAmount),
              netPremiumPaid: decimalOrNull(item.netPremiumPaid), eligibleAmount: decimalOrNull(item.eligibleAmount),
              conversionRate: decimalOrNull(item.conversionRate), conversionDate: item.conversionDate ? new Date(`${item.conversionDate}T00:00:00.000Z`) : null,
              reason: item.reason, evidenceJson: JSON.stringify(item.evidence),
            })) },
          }, select: { id: true },
        });
    await writeActivityLog({
      organizationId: context.organizationId, entityType: "BonusRun", entityId: run.id,
      action: existingRun ? "BONUS_PROJECTION_REFRESH" : "BONUS_PROJECTION_CREATE",
      newValue: { programKey: input.programKey, sellerId: input.sellerId, year: input.year, periodNumber: input.periodNumber, status: projection.status, baseAmount: projection.baseAmount, bonusRate: projection.bonusRate, bonusAmount: projection.bonusAmount },
      userId: context.userId, db: tx,
    });
    return run.id;
  });
  revalidatePath("/bonuses");
  redirect(`/bonuses?run=${encodeURIComponent(runId)}`);
}

export async function confirmAutoBonusEvidenceBatch(formData: FormData) {
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  const sellerId = String(formData.get("sellerId") ?? "").trim();
  const sourceReference = String(formData.get("sourceReference") ?? "").trim();
  if (!sellerId || sourceReference.length < 3 || sourceReference.length > 500 || formData.get("reviewAttestation") !== "on") {
    throw new Error("Selecciona un vendedor, registra la referencia de revisión y confirma que el inventario está completo.");
  }

  const result = await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const sellerMembership = await tx.organizationMembership.findFirst({
      where: { organizationId: context.organizationId, userId: sellerId, active: true, organization: { status: "ACTIVE" }, user: { active: true } },
      select: { id: true },
    });
    if (!sellerMembership) throw new Error("El vendedor seleccionado no pertenece a esta organización activa.");

    const policies = await tx.policy.findMany({
      where: {
        organizationId: context.organizationId,
        policyType: "AUTO",
        OR: [
          { bonusSellerId: sellerId },
          { bonusSellerId: null, client: { organizationId: context.organizationId, portfolioOwnerId: sellerId } },
        ],
        payments: {
          some: {
            organizationId: context.organizationId,
            status: "POSTED",
            paidDate: { gte: new Date("2026-01-01T00:00:00.000Z"), lt: new Date("2027-01-01T00:00:00.000Z") },
            receipt: { status: { not: "CANCELLED" } },
          },
        },
      },
      select: {
        id: true, policyNumber: true, bonusEligibilityJson: true, riskDetails: true, riskDetailsReviewRequired: true,
        insuredAssets: { select: { id: true } },
      },
      orderBy: [{ policyNumber: "asc" }, { id: "asc" }],
    });

    const now = new Date();
    const evidenceAsOf = businessToday(now).toISOString().slice(0, 10);
    const excludedPolicyIds: string[] = [];
    const pendingInventoryPolicyIds: string[] = [];
    const policyIds: string[] = [];
    for (const policy of policies) {
      const riskDetails = policy.riskDetails && typeof policy.riskDetails === "object" && !Array.isArray(policy.riskDetails)
        ? policy.riskDetails as { policyType?: unknown; data?: { vehicles?: unknown } }
        : null;
      const vehicleRows = riskDetails?.policyType === "AUTO" && Array.isArray(riskDetails.data?.vehicles) ? riskDetails.data.vehicles : [];
      const structuredVehicleCount = vehicleRows.filter((row) => row && typeof row === "object" && Object.values(row).some((value) => typeof value === "string" && value.trim())).length;
      const fleet = autoFleetEligibilityFromInventory({
        insuredAssetCount: policy.insuredAssets.length,
        structuredVehicleCount,
        adminConfirmedInventoryComplete: true,
      });
      const priorEvidence = parseBonusEligibilityEvidence(policy.bonusEligibilityJson);
      const evidence = {
        ...priorEvidence,
        productEligible: true,
        fleetUnder50: fleet.fleetUnder50,
        autoExclusionsReviewed: true,
        sellerAttributionConfirmed: true,
        sourceReference,
        evidenceAsOf,
        inventoryVehicleCount: fleet.vehicleCount,
        inventoryAssetsCount: policy.insuredAssets.length,
        inventoryStructuredCount: structuredVehicleCount,
        inventoryReviewRequiredAtConfirmation: policy.riskDetailsReviewRequired,
        batchAttestation: "AUTO_2026_SELLER_POLICIES",
      };
      const value = recordBonusEvidenceReview(JSON.stringify(evidence), context.userId, now);
      await tx.policy.update({ where: { id: policy.id, organizationId: context.organizationId }, data: { bonusSellerId: sellerId, bonusEligibilityJson: value } });
      policyIds.push(policy.id);
      if (fleet.fleetUnder50 === false) excludedPolicyIds.push(policy.id);
      if (fleet.fleetUnder50 === null) pendingInventoryPolicyIds.push(policy.id);
    }

    await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "Policy",
      entityId: "BONUS_AUTO_BULK_CONFIRMATION",
      action: "POLICY_AUTO_BONUS_BULK_CONFIRM",
      newValue: {
        sellerId,
        policyIds,
        policyCount: policyIds.length,
        fleetExcludedPolicyIds: excludedPolicyIds,
        pendingInventoryPolicyIds,
        sourceReference,
        evidenceAsOf,
        reviewedById: context.userId,
        reviewedAt: now.toISOString(),
      },
      userId: context.userId,
      db: tx,
    });
    return { confirmed: policyIds.length, excluded: excludedPolicyIds.length, pendingInventory: pendingInventoryPolicyIds.length };
  });

  revalidatePath("/bonuses");
  redirect(`/bonuses?autosConfirmed=${result.confirmed}&autosExcluded=${result.excluded}&autosPendingInventory=${result.pendingInventory}`);
}

export async function approveBonusRun(formData: FormData) {
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  const runId = String(formData.get("runId") ?? "");
  const expectedVersion = Number(formData.get("version") ?? 0);
  if (formData.get("reviewAttestation") !== "on") throw new Error("Confirma que revisaste el detalle del cierre antes de aprobarlo.");
  if (!runId || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("Falta el cierre o su versión esperada.");
  await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "BonusRun" WHERE "id" = ${runId} AND "organizationId" = ${context.organizationId} FOR UPDATE`);
    const run = await tx.bonusRun.findFirst({
      where: { id: runId, organizationId: context.organizationId },
      include: { items: { select: { status: true } } },
    });
    if (!run) throw new Error("El cierre no existe en esta organización.");
    if (run.version !== expectedVersion) throw new Error("La proyección cambió desde que se abrió; vuelve a revisarla antes de aprobar.");
    if (run.status !== "READY" || run.items.some((item) => item.status === "REVIEW")) throw new Error("Resuelve todas las partidas pendientes y vuelve a generar la proyección antes de aprobar.");
    const periodCompleteOn = run.periodType === "QUARTERLY"
      ? new Date(Date.UTC(run.year, run.periodNumber * 3, 1))
      : new Date(Date.UTC(run.year + 1, 0, 1));
    if (businessToday() < periodCompleteOn) throw new Error("El periodo todavía no cierra; se puede aprobar hasta después de su último día.");
    const approved = await tx.bonusRun.update({
      where: { id: run.id },
      data: { status: "APPROVED", approvedById: context.userId, approvedAt: new Date(), version: { increment: 1 } },
    });
    await writeActivityLog({
      organizationId: context.organizationId, entityType: "BonusRun", entityId: run.id,
      action: "BONUS_RUN_APPROVE", oldValue: { status: run.status },
      newValue: { status: approved.status, approvedById: context.userId, approvedAt: approved.approvedAt, version: approved.version },
      userId: context.userId, db: tx,
    });
  });
  revalidatePath("/bonuses");
  redirect(`/bonuses?run=${encodeURIComponent(runId)}`);
}
