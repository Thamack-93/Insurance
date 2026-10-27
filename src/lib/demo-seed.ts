import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { syncAutoCaptureReceipts } from "@/lib/policy-capture-receipts";
import { getBusinessDateKey } from "@/lib/business-dates";
import { policyRiskDetailsSchema, projectPolicyRiskRelations } from "@/lib/policy-risk-details";
import { serializeBonusEligibilityEvidence } from "@/lib/bonus-evidence";
import { calculateVatFromGross } from "@/lib/premium-breakdown";
import { calculateCommissionEstimate, parseCommissionRules, type CommissionPremiumComponents } from "@/lib/commissions.logic";
import { calculateBonusProjection } from "@/lib/bonus-calculation";
import { BONUS_PROGRAMS } from "@/lib/bonus-rules";

export const DEMO_SEED_VERSION = "demo-2026-10-v8";

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const id = (organizationId: string, type: string, ordinal: number) => `${organizationId}:demo:${type}:${String(ordinal).padStart(3, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function createDemoPolicyRiskDetails(policy: { ordinal: number; type: string; insuredObject: string }) {
  const sourceText = policy.insuredObject;
  switch (policy.type) {
    case "AUTO":
      return policyRiskDetailsSchema.parse({
        version: 1,
        policyType: "AUTO",
        sourceText,
        commissionUnitClass: "DEMO",
        data: { vehicles: [{ make: policy.ordinal === 1 ? "Toyota" : "Nissan", model: policy.ordinal === 1 ? "Corolla" : "Versa", year: policy.ordinal === 1 ? "2020" : "2022", version: policy.ordinal === 1 ? "LE" : "", vin: "", plates: "", unitClass: "DEMO" }] },
      });
    case "GMM":
      return policyRiskDetailsSchema.parse({
        version: 1,
        policyType: "GMM",
        sourceText,
        commissionUnitClass: "DEMO",
        data: { insuredPeople: [{ fullName: `Titular DEMO sintético ${policy.ordinal}`, birthDate: "", relationship: "Titular", unitClass: "DEMO" }], plan: "Plan médico sintético DEMO", insuredAmount: "", deductible: "", coinsurance: "" },
      });
    case "HOGAR":
      return policyRiskDetailsSchema.parse({
        version: 1,
        policyType: "HOGAR",
        sourceText,
        commissionUnitClass: "DEMO",
        data: { locations: [{ address: "Ciudad de México · domicilio sintético DEMO", use: "Casa habitación", construction: "", activity: "", insuredValue: "", unitClass: "DEMO" }] },
      });
    case "EMPRESARIAL":
      return policyRiskDetailsSchema.parse({
        version: 1,
        policyType: "EMPRESARIAL",
        sourceText,
        commissionUnitClass: "DEMO",
        data: { activity: "Actividad comercial sintética DEMO", locations: [{ address: "Ciudad de México · ubicación sintética DEMO", use: "Local u oficina", construction: "", activity: "Actividad comercial sintética DEMO", insuredValue: "", unitClass: "DEMO" }], buildingValue: "", contentsValue: "", businessInterruptionValue: "" },
      });
    case "VIDA":
      return policyRiskDetailsSchema.parse({
        version: 1,
        policyType: "VIDA",
        sourceText,
        commissionUnitClass: "DEMO",
        data: { insuredPeople: [{ fullName: `Titular DEMO sintético ${policy.ordinal}`, birthDate: "", relationship: "Titular", unitClass: "DEMO" }], plan: "Cobertura individual sintética DEMO", insuredAmount: "", term: "", beneficiaries: [{ fullName: `Beneficiario DEMO sintético ${policy.ordinal}`, relationship: "Ejemplo sintético", percentage: "" }] },
      });
    default:
      throw new Error(`DEMO_SEED_UNSUPPORTED_POLICY_TYPE:${policy.type}`);
  }
}

function buildDemoCommissionSnapshot(input: {
  amount: number;
  vatAmount: number | null;
  issuanceExpenseAmount: number | null;
  surchargeAmount: number | null;
  discountAmount: number | null;
  policyType: string;
  productPlan: string;
  paymentFrequency: string;
  asOf: Date;
  assetId?: string | null;
  description: string;
  rules: ReturnType<typeof parseCommissionRules>;
}) {
  const components: CommissionPremiumComponents = {
    totalPremium: input.amount,
    iva: input.vatAmount ?? Number.NaN,
    issuanceExpense: input.issuanceExpenseAmount ?? Number.NaN,
    installmentSurcharge: input.surchargeAmount ?? Number.NaN,
    visibleDiscounts: input.discountAmount ?? Number.NaN,
  };
  const estimate = calculateCommissionEstimate(components, input.rules, {
    policyType: input.policyType,
    productPlan: input.productPlan || "SIN_PLAN",
    policyMode: input.policyType === "AUTO" ? "*" : "",
    unitClass: "DEMO",
    paymentFrequency: input.paymentFrequency,
  }, input.asOf);
  if (estimate.status !== "CALCULATED" || estimate.amount === undefined || !estimate.rule || estimate.netPremium === undefined || estimate.commissionableBase === undefined || estimate.rate === undefined) {
    throw new Error(`DEMO_SEED_COMMISSION_CALCULATION_FAILED:${input.policyType}:${estimate.reason ?? "sin detalle"}`);
  }
  const expectedAmount = estimate.amount;
  const calculationBreakdownJson = JSON.stringify({
    calculatedAt: new Date().toISOString(),
    ruleVersion: 1,
    breakdown: [{
      assetId: input.assetId ?? null,
      description: input.description,
      unitClass: "DEMO",
      components: {
        totalPremium: components.totalPremium,
        vatAmount: components.iva,
        issuanceExpenseAmount: components.issuanceExpense,
        surchargeAmount: components.installmentSurcharge,
        discountAmount: components.visibleDiscounts,
      },
      netPremium: estimate.netPremium,
      commissionableBase: estimate.commissionableBase,
      rate: estimate.rate,
      expectedAmount,
      ruleId: estimate.rule.id,
      ruleSource: estimate.rule.source,
      ruleEvidence: estimate.rule.evidence,
    }],
  });
  return { expectedAmount, percentage: estimate.rate, calculationBreakdownJson };
}

/** Deterministic, synthetic portfolio used by every reset/provisioning run. */
export async function seedDemoBaseline(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string) {
  const now = new Date(`${getBusinessDateKey(new Date())}T12:00:00.000Z`);
  const insurerA = id(organizationId, "insurer", 1);
  const insurerB = id(organizationId, "insurer", 2);
  const insurerC = id(organizationId, "insurer", 3);
  const insurerD = id(organizationId, "insurer", 4);
  const demoCommissionRules = ["AUTO", "GMM", "HOGAR", "EMPRESARIAL", "VIDA"].map((policyType) => ({ id: `demo-flat-10-${policyType}`, policyType, productPlan: "*", policyMode: "*", unitClass: "*", paymentFrequency: "*", rate: 10, validFrom: "2020-01-01", validTo: null, active: true, evidence: "Regla sintética DEMO al 10%; no representa una oferta real de aseguradora." }));
  await tx.insurer.upsert({ where: { id: insurerA }, update: { organizationId, name: "Quálitas · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 }, create: { id: insurerA, organizationId, name: "Quálitas · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 } });
  await tx.insurer.upsert({ where: { id: insurerB }, update: { organizationId, name: "Banorte · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 }, create: { id: insurerB, organizationId, name: "Banorte · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 } });
  await tx.insurer.upsert({ where: { id: insurerC }, update: { organizationId, name: "HDI · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 }, create: { id: insurerC, organizationId, name: "HDI · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 } });
  await tx.insurer.upsert({ where: { id: insurerD }, update: { organizationId, name: "Chubb · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 }, create: { id: insurerD, organizationId, name: "Chubb · DEMO", status: "ACTIVE", commissionRules: demoCommissionRules, commissionRulesVersion: 1 } });

  const clients = [
    { id: id(organizationId, "client", 1), name: "Ana López", type: "PERSON", email: "ana.lopez@example.invalid", phone: "" },
    { id: id(organizationId, "client", 2), name: "Grupo Roble S.A. de C.V.", type: "COMPANY", email: "grupo.roble@example.invalid", phone: "" },
    { id: id(organizationId, "client", 3), name: "Carlos Méndez", type: "PERSON", email: "carlos.mendez@example.invalid", phone: "" },
  ];
  const additionalClientNames = [
    "Laura Serrano", "Mateo Ibarra", "Sofía Cervantes", "Diego Paredes", "Valeria Nájera", "Emilio Beltrán",
    "Regina Molina", "Julián Vega", "Camila Salas", "Nicolás Tovar", "Mariana Ríos", "Fernanda Luna",
    "Gabriel Ortiz", "Paula Medina", "Andrés Rangel", "Elena Campos", "Ricardo Fuentes",
  ];
  clients.push(...additionalClientNames.map((name, index) => {
    const ordinal = index + 4;
    return { id: id(organizationId, "client", ordinal), name, type: ordinal % 5 === 0 ? "COMPANY" : "PERSON", email: `demo.client.${ordinal}@example.invalid`, phone: "" };
  }));
  // 40 policies across 20 clients: 9 have 1, 6 have 2, 3 have 3, 1 has 4, and 1 has 6.
  const policiesPerClient = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 6];
  const policyClientIds = policiesPerClient.flatMap((count, clientIndex) =>
    Array.from({ length: count }, () => clients[clientIndex]!.id),
  );
  for (const client of clients) {
    await tx.client.upsert({
      where: { id: client.id },
      update: { organizationId, fullName: client.name, type: client.type, email: client.email, phone: client.phone, status: "ACTIVE", portfolioOwnerId: actorUserId, createdById: actorUserId, updatedById: actorUserId },
      create: { id: client.id, organizationId, fullName: client.name, type: client.type, email: client.email, phone: client.phone, status: "ACTIVE", portfolioOwnerId: actorUserId, createdById: actorUserId, updatedById: actorUserId },
    });
  }

  const policies = [
    { ordinal: 1, clientId: policyClientIds[0]!, insurerId: insurerA, number: "AU-260001", type: "AUTO", insuredObject: "Toyota Corolla 2020 LE · vehículo de ejemplo", start: -365, end: 9, premium: 18500 },
    { ordinal: 2, clientId: policyClientIds[1]!, insurerId: insurerB, number: "GM-260002", type: "GMM", insuredObject: "Plan familiar de gastos médicos · titular de ejemplo", start: -365, end: 180, premium: 74000 },
    { ordinal: 3, clientId: policyClientIds[2]!, insurerId: insurerA, number: "HO-260003", type: "HOGAR", insuredObject: "Casa habitación · Ciudad de México", start: -365, end: -10, premium: 9200 },
    { ordinal: 4, clientId: policyClientIds[3]!, insurerId: insurerA, number: "PY-260004", type: "EMPRESARIAL", insuredObject: "Local comercial y contenido · Ciudad de México", start: -365, end: 335, premium: 125000 },
  ];
  policies.push(...Array.from({ length: 36 }, (_, index) => {
    const ordinal = index + 5;
    const types = ["AUTO", "GMM", "HOGAR", "EMPRESARIAL", "VIDA"];
    const insurers = [insurerA, insurerB, insurerC, insurerD];
    const end = ordinal === 40 ? 120 : ordinal % 5 === 0 ? -14 : ordinal % 4 === 0 ? 28 : 90 + (ordinal % 6) * 30;
    const type = types[(ordinal - 1) % types.length]!;
    const insuredObject = type === "AUTO"
      ? `Nissan Versa 2022 · unidad ${String(ordinal).padStart(3, "0")}`
      : type === "GMM"
        ? "Plan médico familiar · cobertura integral"
        : type === "HOGAR"
          ? "Casa habitación · domicilio en Ciudad de México"
          : type === "EMPRESARIAL"
            ? "Oficina y equipo comercial · Ciudad de México"
            : "Seguro de vida individual · cobertura amplia";
    const policyPrefixes = { AUTO: "AU", GMM: "GM", HOGAR: "HO", EMPRESARIAL: "PY", VIDA: "VI" } as const;
    return { ordinal, clientId: policyClientIds[ordinal - 1]!, insurerId: insurers[(ordinal - 1) % insurers.length], number: `${policyPrefixes[type as keyof typeof policyPrefixes]}-26${String(ordinal).padStart(4, "0")}`, type, insuredObject, start: -365, end, premium: 8500 + ordinal * 4100 };
  }));
  const frequencies = ["ANNUAL", "SEMIANNUAL", "QUARTERLY", "MONTHLY"] as const;
  const policyIds: string[] = [];
  const demoReceiptIds: string[] = [];
  const demoReceiptSchedules: string[][] = [];
  const businessDate = getBusinessDateKey(now);
  const parsedDemoCommissionRules = parseCommissionRules(demoCommissionRules);
  const demoEvidenceFor = (policyType: string) => serializeBonusEligibilityEvidence({
    productEligible: true,
    sellerAttributionConfirmed: true,
    sourceReference: `Semilla sintética ${DEMO_SEED_VERSION}`,
    evidenceAsOf: businessDate,
    reviewedById: actorUserId,
    reviewedAt: now.toISOString(),
    ...(policyType === "AUTO" ? { fleetUnder50: true, autoExclusionsReviewed: true, inventoryVehicleCount: 1, batchAttestation: "DEMO_SYNTHETIC" } : {}),
    ...(["HOGAR", "EMPRESARIAL"].includes(policyType) ? { businessType: "Ejemplo sintético DEMO", facultativeInsuranceReviewed: true, specialConditionsReviewed: true, directedBusinessReviewed: true, frontingReviewed: true, damageExclusionsReviewed: true } : {}),
  });
  for (const policyInput of policies) {
    const policyId = id(organizationId, "policy", policyInput.ordinal);
    const riskDetails = createDemoPolicyRiskDetails(policyInput);
    policyIds.push(policyId);
    await tx.policy.upsert({
      where: { id: policyId },
      update: { organizationId, clientId: policyInput.clientId, insurerId: policyInput.insurerId, policyNumber: policyInput.number, policyType: policyInput.type, insuredObject: policyInput.insuredObject, riskDetails: riskDetails as Prisma.InputJsonValue, riskDetailsReviewRequired: false, status: policyInput.ordinal === 40 ? "CANCELLED" : policyInput.end < 0 ? "EXPIRED" : "ACTIVE", cancellationReason: policyInput.ordinal === 40 ? "Cancelación solicitada por el cliente" : null, cancelledAt: policyInput.ordinal === 40 ? addDays(now, -12) : null, renewalStage: policyInput.ordinal % 5 === 0 ? "CONTACTED" : policyInput.ordinal % 4 === 0 ? "QUOTED" : "PENDING", startDate: addDays(now, policyInput.start), endDate: addDays(now, policyInput.end), premiumAmount: policyInput.premium, premiumVatAmount: calculateVatFromGross(policyInput.premium), premiumIssuanceExpenseAmount: 0, premiumSurchargeAmount: 0, premiumDiscountAmount: 0, bonusSellerId: actorUserId, bonusEligibilityJson: demoEvidenceFor(policyInput.type), currency: "MXN", paymentFrequency: frequencies[(policyInput.ordinal - 1) % frequencies.length], createdById: actorUserId, updatedById: actorUserId },
      create: { id: policyId, organizationId, clientId: policyInput.clientId, insurerId: policyInput.insurerId, policyNumber: policyInput.number, policyType: policyInput.type, insuredObject: policyInput.insuredObject, riskDetails: riskDetails as Prisma.InputJsonValue, riskDetailsReviewRequired: false, status: policyInput.ordinal === 40 ? "CANCELLED" : policyInput.end < 0 ? "EXPIRED" : "ACTIVE", cancellationReason: policyInput.ordinal === 40 ? "Cancelación solicitada por el cliente" : null, cancelledAt: policyInput.ordinal === 40 ? addDays(now, -12) : null, renewalStage: policyInput.ordinal % 5 === 0 ? "CONTACTED" : policyInput.ordinal % 4 === 0 ? "QUOTED" : "PENDING", startDate: addDays(now, policyInput.start), endDate: addDays(now, policyInput.end), premiumAmount: policyInput.premium, premiumVatAmount: calculateVatFromGross(policyInput.premium), premiumIssuanceExpenseAmount: 0, premiumSurchargeAmount: 0, premiumDiscountAmount: 0, bonusSellerId: actorUserId, bonusEligibilityJson: demoEvidenceFor(policyInput.type), currency: "MXN", paymentFrequency: frequencies[(policyInput.ordinal - 1) % frequencies.length], createdById: actorUserId, updatedById: actorUserId },
    });
    const relations = projectPolicyRiskRelations(riskDetails);
    for (const [index, asset] of relations.assets.entries()) {
      const assetId = id(organizationId, `policy-asset-${policyInput.ordinal}`, index + 1);
      await tx.policyInsuredAsset.upsert({ where: { id: assetId }, update: { organizationId, policyId, ...asset }, create: { id: assetId, organizationId, policyId, ...asset } });
    }
    for (const [index, party] of relations.insuredParties.entries()) {
      const partyId = id(organizationId, `policy-party-${policyInput.ordinal}`, index + 1);
      await tx.policyInsuredParty.upsert({ where: { id: partyId }, update: { organizationId, policyId, ...party }, create: { id: partyId, organizationId, policyId, ...party } });
    }
    const receipts = await syncAutoCaptureReceipts(tx, { organizationId, policyId, clientId: policyInput.clientId, insurerId: policyInput.insurerId, userId: actorUserId, premiumBreakdown: { issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0 }, draft: { startDate: addDays(now, policyInput.start).toISOString().slice(0, 10), endDate: addDays(now, policyInput.end).toISOString().slice(0, 10), paymentFrequency: frequencies[(policyInput.ordinal - 1) % frequencies.length], premiumAmount: policyInput.premium, currency: "MXN", sourcePolicyNumber: policyInput.number } });
    const receiptId = receipts[0]?.receipt.id;
    if (!receiptId) throw new Error("DEMO_SEED_RECEIPT_SCHEDULE_FAILED");
    demoReceiptIds[policyInput.ordinal - 1] = receiptId;
    const schedule = await tx.receipt.findMany({ where: { organizationId, policyId, endorsementId: null }, select: { id: true, receiptNumber: true, dueDate: true, paidDate: true, amount: true, currency: true, status: true, vatAmount: true, issuanceExpenseAmount: true, surchargeAmount: true, discountAmount: true }, orderBy: { dueDate: "asc" } });
    if (!schedule.length) throw new Error("DEMO_SEED_RECEIPT_SCHEDULE_MISSING");
    demoReceiptSchedules[policyInput.ordinal - 1] = schedule.map((receipt) => receipt.id);
    for (const [installmentIndex, receipt] of schedule.entries()) {
      const overdueExample = policyInput.ordinal === 2 && installmentIndex === 0;
      const upcomingPaymentExample = policyInput.ordinal === 4 && installmentIndex === schedule.length - 1;
      if (policyInput.ordinal === 40) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { status: "CANCELLED", cancellationReason: "Cancelación de la póliza", commissionCalculationStatus: "NOT_CALCULATED", commissionReviewReason: null } });
      } else if (overdueExample) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { status: "OVERDUE", dueDate: addDays(now, -3) } });
      } else if (upcomingPaymentExample) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { status: "PENDING", dueDate: addDays(now, 5), paidDate: null, paymentMethod: null } });
      } else if (getBusinessDateKey(receipt.dueDate) < businessDate) {
        await tx.receipt.update({ where: { id: receipt.id }, data: { status: "PAID", paidDate: receipt.dueDate, paymentMethod: "TRANSFER" } });
        const paymentOrdinal = policyInput.ordinal === 1 && installmentIndex === 0 ? 1 : 100 + (policyInput.ordinal - 1) * 20 + installmentIndex;
        const paymentId = id(organizationId, "payment", paymentOrdinal);
        const paymentData = { organizationId, receiptId: receipt.id, policyId, clientId: policyInput.clientId, amount: receipt.amount, currency: receipt.currency, status: "POSTED" as const, paidDate: receipt.dueDate, paymentMethod: "TRANSFER", createdById: actorUserId, updatedById: actorUserId };
        await tx.payment.upsert({ where: { id: paymentId }, update: paymentData, create: { id: paymentId, ...paymentData } });
      }
    }
    const finalizedSchedule = await tx.receipt.findMany({ where: { organizationId, policyId, endorsementId: null }, select: { id: true, receiptNumber: true, dueDate: true, paidDate: true, amount: true, status: true, vatAmount: true, issuanceExpenseAmount: true, surchargeAmount: true, discountAmount: true }, orderBy: { dueDate: "asc" } });
    for (const [installmentIndex, receipt] of finalizedSchedule.entries()) {
      if (receipt.status === "CANCELLED") continue;
      const asOf = receipt.paidDate ?? receipt.dueDate;
      const calculation = buildDemoCommissionSnapshot({
        amount: Number(receipt.amount), vatAmount: receipt.vatAmount === null ? null : Number(receipt.vatAmount),
        issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : Number(receipt.issuanceExpenseAmount),
        surchargeAmount: receipt.surchargeAmount === null ? null : Number(receipt.surchargeAmount),
        discountAmount: receipt.discountAmount === null ? null : Number(receipt.discountAmount),
        policyType: policyInput.type,
        productPlan: policyInput.type === "GMM" || policyInput.type === "VIDA" ? (policyInput.type === "GMM" ? "Plan médico sintético DEMO" : "Cobertura individual sintética DEMO") : "SIN_PLAN",
        paymentFrequency: frequencies[(policyInput.ordinal - 1) % frequencies.length]!,
        asOf,
        description: "Póliza DEMO (prima agregada)",
        rules: parsedDemoCommissionRules,
      });
      const paidCommissionExample = policyInput.ordinal === 1 && installmentIndex === 0;
      const commissionStatus = paidCommissionExample ? "PAID" as const : receipt.status === "OVERDUE" ? "OVERDUE" as const : receipt.status === "PAID" ? "PENDING" as const : "EXPECTED" as const;
      const commissionOrdinal = installmentIndex === 0 && policyInput.ordinal <= 4
        ? policyInput.ordinal
        : (policyInput.ordinal - 1) * 12 + installmentIndex + 1;
      const commissionId = id(organizationId, "commission", commissionOrdinal);
      const commissionData = {
        organizationId, policyId, receiptId: receipt.id, clientId: policyInput.clientId, insurerId: policyInput.insurerId,
        expectedAmount: calculation.expectedAmount,
        actualAmount: commissionStatus === "PAID" ? calculation.expectedAmount : null,
        percentage: calculation.percentage,
        expectedDate: commissionStatus === "OVERDUE" ? addDays(now, -12) : addDays(receipt.dueDate, 30),
        paidDate: commissionStatus === "PAID" ? addDays(now, -3) : null,
        status: commissionStatus,
        calculationBreakdownJson: calculation.calculationBreakdownJson,
      };
      await tx.commission.upsert({ where: { id: commissionId }, update: commissionData, create: { id: commissionId, ...commissionData } });
      await tx.receipt.update({ where: { id: receipt.id }, data: { commissionCalculationStatus: "CALCULATED", commissionReviewReason: null, updatedById: actorUserId } });
    }
    if (policyInput.ordinal === 2) {
      await tx.payment.upsert({ where: { id: id(organizationId, "payment", 2) }, update: { organizationId, receiptId, policyId, clientId: policyInput.clientId, amount: policyInput.premium, currency: "MXN", status: "REVERSED", paidDate: addDays(now, -2), paymentMethod: "TRANSFER", reversedById: actorUserId, reversedAt: addDays(now, -1), reversalReason: "DEMO reversal example", createdById: actorUserId, updatedById: actorUserId }, create: { id: id(organizationId, "payment", 2), organizationId, receiptId, policyId, clientId: policyInput.clientId, amount: policyInput.premium, currency: "MXN", status: "REVERSED", paidDate: addDays(now, -2), paymentMethod: "TRANSFER", reversedById: actorUserId, reversedAt: addDays(now, -1), reversalReason: "DEMO reversal example", createdById: actorUserId, updatedById: actorUserId } });
    }
  }

  const statementId = id(organizationId, "commission-statement", 1);
  await tx.commissionStatement.upsert({
    where: { id: statementId },
    update: { organizationId, sourceFileName: "DEMO-comisiones-septiembre.csv", sourceFilePath: null, mimeType: "text/csv", sourceHash: hash(`${organizationId}:demo-commission-statement`), periodStart: addDays(now, -30), periodEnd: now, status: "APPLIED", summaryJson: JSON.stringify({ synthetic: true, rows: 1, applied: 1 }), approvedById: actorUserId, approvedAt: now, appliedAt: now, createdById: actorUserId },
    create: { id: statementId, organizationId, sourceFileName: "DEMO-comisiones-septiembre.csv", mimeType: "text/csv", sourceHash: hash(`${organizationId}:demo-commission-statement`), periodStart: addDays(now, -30), periodEnd: now, status: "APPLIED", summaryJson: JSON.stringify({ synthetic: true, rows: 1, applied: 1 }), approvedById: actorUserId, approvedAt: now, appliedAt: now, createdById: actorUserId },
  });
  const commissionForStatement = await tx.commission.findFirst({ where: { organizationId, id: id(organizationId, "commission", 1) }, select: { id: true, expectedAmount: true, paidDate: true } });
  if (commissionForStatement) {
    const matchedAmount = Number(commissionForStatement.expectedAmount);
    const matchedPaymentDate = commissionForStatement.paidDate ?? addDays(now, -3);
    await tx.commissionStatementRow.upsert({
      where: { statementId_sourceRowKey: { statementId, sourceRowKey: "demo-row-1" } },
      update: { organizationId, sourcePage: 1, rawJson: JSON.stringify({ policyNumber: "AU-260001", amount: matchedAmount }), normalizedJson: JSON.stringify({ policyNumber: "AU-260001", amount: matchedAmount }), policyNumber: "AU-260001", receiptNumber: "1", currency: "MXN", amount: matchedAmount, paymentDate: matchedPaymentDate, status: "APPLIED", matchReason: "Coincidencia y aplicación sintéticas DEMO", commissionId: commissionForStatement.id },
      create: { id: id(organizationId, "commission-statement-row", 1), organizationId, statementId, sourceRowKey: "demo-row-1", sourcePage: 1, rawJson: JSON.stringify({ policyNumber: "AU-260001", amount: matchedAmount }), normalizedJson: JSON.stringify({ policyNumber: "AU-260001", amount: matchedAmount }), policyNumber: "AU-260001", receiptNumber: "1", currency: "MXN", amount: matchedAmount, paymentDate: matchedPaymentDate, status: "APPLIED", matchReason: "Coincidencia y aplicación sintéticas DEMO", commissionId: commissionForStatement.id },
    });
  }

  const endorsementId = id(organizationId, "endorsement", 1);
  await tx.policyEndorsement.upsert({
    where: { id: endorsementId },
    update: { organizationId, endorsementNumber: "DEMO-END-001", policyId: policyIds[1], status: "ACTIVE", startDate: addDays(now, -15), endDate: addDays(now, 180), amount: 3500, currency: "MXN", concept: "Ajuste sintético de cobertura para Titular DEMO sintético 2", createdById: actorUserId, updatedById: actorUserId },
    create: { id: endorsementId, organizationId, endorsementNumber: "DEMO-END-001", policyId: policyIds[1], status: "ACTIVE", startDate: addDays(now, -15), endDate: addDays(now, 180), amount: 3500, currency: "MXN", concept: "Ajuste sintético de cobertura para Titular DEMO sintético 2", createdById: actorUserId, updatedById: actorUserId },
  });
  const endorsementAsset = await tx.policyInsuredAsset.findFirst({ where: { organizationId, policyId: policyIds[1] }, select: { id: true } });
  const endorsementVat = calculateVatFromGross(3500);
  if (!endorsementAsset || endorsementVat === null) throw new Error("DEMO_SEED_ENDORSEMENT_RISK_MISSING");
  const endorsementReceiptId = id(organizationId, "endorsement-receipt", 1);
  const endorsementReceiptData = {
    organizationId,
    receiptNumber: "END-001",
    receiptSequence: null,
    policyId: policyIds[1]!,
    endorsementId,
    clientId: policies[1]!.clientId,
    insurerId: policies[1]!.insurerId,
    periodStartDate: addDays(now, -15),
    periodEndDate: addDays(now, 180),
    dueDate: addDays(now, 5),
    amount: 3500,
    vatAmount: endorsementVat,
    issuanceExpenseAmount: 0,
    surchargeAmount: 0,
    discountAmount: 0,
    premiumBreakdownByUnit: [{ insuredAssetId: endorsementAsset.id, totalPremium: 3500, vatAmount: endorsementVat, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0 }],
    currency: "MXN",
    status: "PENDING" as const,
    paidDate: null,
    paymentMethod: null,
    commissionCalculationStatus: "NOT_CALCULATED",
    commissionReviewReason: null,
    notes: "Ejemplo sintético de recibo de endoso DEMO.",
    createdById: actorUserId,
    updatedById: actorUserId,
  };
  await tx.receipt.upsert({ where: { id: endorsementReceiptId }, update: endorsementReceiptData, create: { id: endorsementReceiptId, ...endorsementReceiptData } });
  const endorsementCommission = buildDemoCommissionSnapshot({
    amount: 3500, vatAmount: endorsementVat, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0,
    policyType: "GMM", productPlan: "Plan médico sintético DEMO", paymentFrequency: "SEMIANNUAL", asOf: endorsementReceiptData.dueDate,
    assetId: endorsementAsset.id, description: "Titular DEMO sintético 2", rules: parsedDemoCommissionRules,
  });
  await tx.commission.upsert({
    where: { id: id(organizationId, "commission", 1000) },
    update: { organizationId, policyId: policyIds[1], receiptId: endorsementReceiptId, clientId: policies[1]!.clientId, insurerId: policies[1]!.insurerId, expectedAmount: endorsementCommission.expectedAmount, actualAmount: null, percentage: endorsementCommission.percentage, expectedDate: addDays(endorsementReceiptData.dueDate, 30), paidDate: null, status: "EXPECTED", calculationBreakdownJson: endorsementCommission.calculationBreakdownJson },
    create: { id: id(organizationId, "commission", 1000), organizationId, policyId: policyIds[1], receiptId: endorsementReceiptId, clientId: policies[1]!.clientId, insurerId: policies[1]!.insurerId, expectedAmount: endorsementCommission.expectedAmount, actualAmount: null, percentage: endorsementCommission.percentage, expectedDate: addDays(endorsementReceiptData.dueDate, 30), paidDate: null, status: "EXPECTED", calculationBreakdownJson: endorsementCommission.calculationBreakdownJson },
  });
  await tx.receipt.update({ where: { id: endorsementReceiptId }, data: { commissionCalculationStatus: "CALCULATED", commissionReviewReason: null, updatedById: actorUserId } });

  const maintenanceRunId = id(organizationId, "maintenance-run", 1);
  await tx.maintenanceRun.upsert({ where: { id: maintenanceRunId }, update: { organizationId, type: "DEMO_DATA_QUALITY", status: "COMPLETED", summaryJson: JSON.stringify({ synthetic: true }), completedAt: now, createdById: actorUserId }, create: { id: maintenanceRunId, organizationId, type: "DEMO_DATA_QUALITY", status: "COMPLETED", summaryJson: JSON.stringify({ synthetic: true }), startedAt: addDays(now, -1), completedAt: now, createdById: actorUserId } });
  const suppressionRuleId = id(organizationId, "suppression-rule", 1);
  await tx.dataQualitySuppressionRule.upsert({ where: { id: suppressionRuleId }, update: { organizationId, category: "DEMO", issueCode: "SYNTHETIC_EXAMPLE", criteriaJson: JSON.stringify({ source: "demo-seed" }), active: true, reason: "Synthetic demonstration record", createdById: actorUserId, reviewedById: actorUserId, reviewedAt: now }, create: { id: suppressionRuleId, organizationId, category: "DEMO", issueCode: "SYNTHETIC_EXAMPLE", criteriaJson: JSON.stringify({ source: "demo-seed" }), active: true, reason: "Synthetic demonstration record", createdById: actorUserId, reviewedById: actorUserId, reviewedAt: now } });
  const reconciliationIssueId = id(organizationId, "reconciliation-issue", 1);
  await tx.receiptReconciliationIssue.upsert({ where: { id: reconciliationIssueId }, update: { organizationId, maintenanceRunId, receiptId: demoReceiptIds[1], policyId: policyIds[1], reason: "DEMO reversed payment requires review", status: "OPEN", detailsJson: JSON.stringify({ synthetic: true }), expectedAmount: policies[1].premium, paidAmount: 0, suppressedByRuleId: suppressionRuleId }, create: { id: reconciliationIssueId, organizationId, maintenanceRunId, receiptId: demoReceiptIds[1], policyId: policyIds[1], reason: "DEMO reversed payment requires review", status: "OPEN", detailsJson: JSON.stringify({ synthetic: true }), expectedAmount: policies[1].premium, paidAmount: 0, suppressedByRuleId: suppressionRuleId } });
  const renewalSuggestionId = id(organizationId, "renewal-suggestion", 1);
  await tx.policyRenewalSuggestion.upsert({ where: { id: renewalSuggestionId }, update: { organizationId, maintenanceRunId, sourcePolicyId: policyIds[0], targetPolicyId: policyIds[3], status: "PENDING", confidence: 0.91, reason: "DEMO renewal candidate", suppressedByRuleId: null }, create: { id: renewalSuggestionId, organizationId, maintenanceRunId, sourcePolicyId: policyIds[0], targetPolicyId: policyIds[3], status: "PENDING", confidence: 0.91, reason: "DEMO renewal candidate" } });

  const documentId = id(organizationId, "document", 1);
  await tx.document.upsert({ where: { id: documentId }, update: { organizationId, clientId: clients[0].id, policyId: policyIds[0], documentType: "POLICY", fileName: "DEMO-policy-synthetic.pdf", filePath: `demo://${organizationId}/synthetic/policy-001`, mimeType: "application/pdf", notes: "PDF sintético generado por PolicyDesk; no contiene datos reales.", createdById: actorUserId, updatedById: actorUserId }, create: { id: documentId, organizationId, clientId: clients[0].id, policyId: policyIds[0], documentType: "POLICY", fileName: "DEMO-policy-synthetic.pdf", filePath: `demo://${organizationId}/synthetic/policy-001`, mimeType: "application/pdf", notes: "PDF sintético generado por PolicyDesk; no contiene datos reales.", createdById: actorUserId, updatedById: actorUserId } });
  await tx.activityLog.upsert({ where: { id: id(organizationId, "activity", 1) }, update: { organizationId, entityType: "Policy", entityId: policyIds[0], action: "DEMO_SEED_CREATED", newValue: JSON.stringify({ synthetic: true, seedVersion: DEMO_SEED_VERSION }), userId: actorUserId }, create: { id: id(organizationId, "activity", 1), organizationId, entityType: "Policy", entityId: policyIds[0], action: "DEMO_SEED_CREATED", newValue: JSON.stringify({ synthetic: true, seedVersion: DEMO_SEED_VERSION }), userId: actorUserId } });
  const notificationPreferenceId = id(organizationId, "notification-preference", 1);
  await tx.notificationPreference.upsert({ where: { userId_eventType_channelType: { userId: actorUserId, eventType: "RENEWAL", channelType: "IN_APP" } }, update: { id: notificationPreferenceId, organizationId, enabled: true, minPriority: "MEDIUM" }, create: { id: notificationPreferenceId, organizationId, userId: actorUserId, eventType: "RENEWAL", channelType: "IN_APP", enabled: true, minPriority: "MEDIUM" } });
  await tx.notificationEvent.upsert({ where: { id: id(organizationId, "notification", 1) }, update: { organizationId, type: "RENEWAL", title: "DEMO renovación próxima", body: "Ejemplo sintético de notificación.", priority: "HIGH", userId: actorUserId, clientId: clients[0].id, policyId: policyIds[0], dedupeKey: `demo-renewal:${organizationId}`, channelType: "IN_APP", status: "PENDING" }, create: { id: id(organizationId, "notification", 1), organizationId, type: "RENEWAL", title: "DEMO renovación próxima", body: "Ejemplo sintético de notificación.", priority: "HIGH", userId: actorUserId, clientId: clients[0].id, policyId: policyIds[0], dedupeKey: `demo-renewal:${organizationId}`, channelType: "IN_APP", status: "PENDING" } });

  const claimId = id(organizationId, "claim", 1);
  await tx.claim.upsert({ where: { id: claimId }, update: { organizationId, folio: "SIN-260001", clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, claimType: "COLISION", description: "Ejemplo para probar el flujo de siniestros.", incidentDate: addDays(now, -20), reportedDate: addDays(now, -18), amountClaimed: 42000, status: "IN_PROGRESS", createdById: actorUserId, updatedById: actorUserId }, create: { id: claimId, organizationId, folio: "SIN-260001", clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, claimType: "COLISION", description: "Ejemplo para probar el flujo de siniestros.", incidentDate: addDays(now, -20), reportedDate: addDays(now, -18), amountClaimed: 42000, status: "IN_PROGRESS", createdById: actorUserId, updatedById: actorUserId } });
  await tx.claimChecklistItem.upsert({ where: { claimId_requirementCode: { claimId, requirementCode: "INE" } }, update: { organizationId, label: "Identificación oficial", status: "REQUESTED" }, create: { id: id(organizationId, "checklist", 1), organizationId, claimId, requirementCode: "INE", label: "Identificación oficial", status: "REQUESTED" } });
  const extraClaims = [
    { ordinal: 2, policyOrdinal: 1, status: "WAITING_CLIENT", type: "ROBO", amount: 18500, requirement: "FACTURA", requirementStatus: "MISSING" },
    { ordinal: 3, policyOrdinal: 4, status: "WAITING_INSURER", type: "DANOS", amount: 63000, requirement: "AJUSTE", requirementStatus: "RECEIVED" },
    { ordinal: 4, policyOrdinal: 4, status: "OPEN", type: "RESPONSABILIDAD", amount: 27500, requirement: "DECLARACION", requirementStatus: "REQUESTED" },
    { ordinal: 5, policyOrdinal: 3, status: "RESOLVED", type: "CRISTALES", amount: 12800, paidAmount: 12800, requirement: "DICTAMEN", requirementStatus: "RECEIVED" },
  ] as const;
  for (const item of extraClaims) {
    const extraClaimId = id(organizationId, "claim", item.ordinal);
    const policyInput = policies[item.policyOrdinal - 1]!;
    const closedDate = item.status === "RESOLVED" ? addDays(now, -4) : null;
    const amountPaid = item.status === "RESOLVED" ? item.paidAmount : null;
    await tx.claim.upsert({
      where: { id: extraClaimId },
      update: { organizationId, folio: `SIN-260${String(item.ordinal).padStart(3, "0")}`, clientId: policyInput.clientId, policyId: policyIds[item.policyOrdinal - 1], insurerId: policyInput.insurerId, claimType: item.type, description: item.status === "RESOLVED" ? "Siniestro de cristales concluido y pagado." : "Ejemplo para probar estados de siniestros.", incidentDate: addDays(now, -item.ordinal * 11), reportedDate: addDays(now, -item.ordinal * 9), amountClaimed: item.amount, amountPaid, status: item.status, closedDate, createdById: actorUserId, updatedById: actorUserId },
      create: { id: extraClaimId, organizationId, folio: `SIN-260${String(item.ordinal).padStart(3, "0")}`, clientId: policyInput.clientId, policyId: policyIds[item.policyOrdinal - 1], insurerId: policyInput.insurerId, claimType: item.type, description: item.status === "RESOLVED" ? "Siniestro de cristales concluido y pagado." : "Ejemplo para probar estados de siniestros.", incidentDate: addDays(now, -item.ordinal * 11), reportedDate: addDays(now, -item.ordinal * 9), amountClaimed: item.amount, amountPaid, status: item.status, closedDate, createdById: actorUserId, updatedById: actorUserId },
    });
    await tx.claimChecklistItem.upsert({ where: { claimId_requirementCode: { claimId: extraClaimId, requirementCode: item.requirement } }, update: { organizationId, label: `Requisito ${item.requirement}`, status: item.requirementStatus }, create: { id: id(organizationId, "checklist", item.ordinal), organizationId, claimId: extraClaimId, requirementCode: item.requirement, label: `Requisito ${item.requirement}`, status: item.requirementStatus } });
  }

  await tx.task.upsert({ where: { id: id(organizationId, "task", 1) }, update: { organizationId, folio: "REN-260001", clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, title: "Dar seguimiento a renovación", description: "Confirmar condiciones antes del vencimiento.", taskType: "RENEWAL", status: "OPEN", priority: "HIGH", dueDate: addDays(now, 9), createdById: actorUserId, updatedById: actorUserId }, create: { id: id(organizationId, "task", 1), organizationId, folio: "REN-260001", clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, title: "Dar seguimiento a renovación", description: "Confirmar condiciones antes del vencimiento.", taskType: "RENEWAL", status: "OPEN", priority: "HIGH", dueDate: addDays(now, 9), createdById: actorUserId, updatedById: actorUserId } });
  await tx.workItem.upsert({ where: { organizationId_sourceType_sourceId: { organizationId, sourceType: "DEMO", sourceId: "demo-work-item-1" } }, update: { organizationId, sourceType: "DEMO", sourceId: "demo-work-item-1", workItemType: "TASK", taskType: "RENEWAL", status: "OPEN", priority: "HIGH", folio: "REN-260001", title: "Seguimiento de renovación", description: "Confirmar condiciones antes del vencimiento.", entityType: "Policy", entityId: policyIds[0], clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, dueDate: addDays(now, 9), assignedToId: actorUserId }, create: { id: id(organizationId, "work", 1), organizationId, sourceType: "DEMO", sourceId: "demo-work-item-1", workItemType: "TASK", taskType: "RENEWAL", status: "OPEN", priority: "HIGH", folio: "REN-260001", title: "Seguimiento de renovación", description: "Confirmar condiciones antes del vencimiento.", entityType: "Policy", entityId: policyIds[0], clientId: clients[0].id, policyId: policyIds[0], insurerId: insurerA, dueDate: addDays(now, 9), assignedToId: actorUserId } });
  for (const promise of [
    { ordinal: 2, policyOrdinal: 4, receiptIndex: -1, promisedPaymentDate: addDays(now, 3), dueDate: addDays(now, 3), title: "Promesa de pago DEMO confirmada", description: "Cliente sintético prometió pagar el próximo recibo DEMO." },
    { ordinal: 3, policyOrdinal: 2, receiptIndex: 0, promisedPaymentDate: addDays(now, -3), dueDate: addDays(now, -1), title: "Promesa de pago DEMO incumplida", description: "La fecha prometida pasó sin recibir el pago sintético." },
  ]) {
    const receiptSchedule = demoReceiptSchedules[promise.policyOrdinal - 1] ?? [];
    const receiptId = promise.receiptIndex === -1 ? receiptSchedule.at(-1) : receiptSchedule[promise.receiptIndex];
    const promisePolicy = policies[promise.policyOrdinal - 1];
    if (!receiptId || !promisePolicy) throw new Error("DEMO_SEED_COLLECTION_EXAMPLE_MISSING");
    const sourceId = `receipt:${receiptId}:collection-followup`;
    const metadataJson = JSON.stringify({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: promise.promisedPaymentDate.toISOString(), nextContactDate: null, lastContactAt: addDays(now, -2).toISOString() });
    await tx.workItem.upsert({
      where: { organizationId_sourceType_sourceId: { organizationId, sourceType: "Collection", sourceId } },
      update: { organizationId, sourceType: "Collection", sourceId, workItemType: "TASK", taskType: "PAYMENT", status: "OPEN", priority: promise.ordinal === 3 ? "HIGH" : "MEDIUM", folio: `DEMO-PROMISE-${promise.ordinal}`, title: promise.title, description: promise.description, entityType: "Receipt", entityId: receiptId, clientId: promisePolicy.clientId, policyId: policyIds[promise.policyOrdinal - 1], insurerId: promisePolicy.insurerId, receiptId, dueDate: promise.dueDate, assignedToId: actorUserId, metadataJson },
      create: { id: id(organizationId, "work", promise.ordinal), organizationId, sourceType: "Collection", sourceId, workItemType: "TASK", taskType: "PAYMENT", status: "OPEN", priority: promise.ordinal === 3 ? "HIGH" : "MEDIUM", folio: `DEMO-PROMISE-${promise.ordinal}`, title: promise.title, description: promise.description, entityType: "Receipt", entityId: receiptId, clientId: promisePolicy.clientId, policyId: policyIds[promise.policyOrdinal - 1], insurerId: promisePolicy.insurerId, receiptId, dueDate: promise.dueDate, assignedToId: actorUserId, metadataJson },
    });
  }
  await tx.alert.upsert({ where: { id: id(organizationId, "alert", 1) }, update: { organizationId, alertType: "RENEWAL", severity: "HIGH", title: "Póliza DEMO próxima a vencer", description: "Alerta sintética", entityType: "Policy", entityId: policyIds[0], clientId: clients[0].id, policyId: policyIds[0], status: "OPEN" }, create: { id: id(organizationId, "alert", 1), organizationId, alertType: "RENEWAL", severity: "HIGH", title: "Póliza DEMO próxima a vencer", description: "Alerta sintética", entityType: "Policy", entityId: policyIds[0], clientId: clients[0].id, policyId: policyIds[0], status: "OPEN" } });

  const sourceId = id(organizationId, "knowledge-source", 1);
  const knowledgeContentHash = hash(`${organizationId}:${DEMO_SEED_VERSION}:knowledge-content`);
  const knowledgeManifestHash = hash(`${knowledgeContentHash}:manifest`);
  await tx.knowledgeSource.upsert({ where: { id: sourceId }, update: { organizationId, title: "DEMO Guía de atención", version: DEMO_SEED_VERSION, status: "ACTIVE", contentHash: knowledgeContentHash, manifestHash: knowledgeManifestHash, integrityVersion: "CHUNK_MANIFEST_V1", integrityVerifiedAt: now, createdById: actorUserId }, create: { id: sourceId, organizationId, title: "DEMO Guía de atención", version: DEMO_SEED_VERSION, status: "ACTIVE", contentHash: knowledgeContentHash, manifestHash: knowledgeManifestHash, integrityVersion: "CHUNK_MANIFEST_V1", integrityVerifiedAt: now, createdById: actorUserId } });
  await tx.knowledgeChunk.upsert({ where: { sourceId_ordinal: { sourceId, ordinal: 0 } }, update: { organizationId, content: "Contenido sintético para probar búsqueda y Nora.", section: "Demo" }, create: { id: id(organizationId, "knowledge-chunk", 1), organizationId, sourceId, ordinal: 0, content: "Contenido sintético para probar búsqueda y Nora.", section: "Demo" } });

  const reportId = id(organizationId, "assistant-report", 1);
  await tx.assistantReport.upsert({ where: { id: reportId }, update: { organizationId, kind: "DEMO", themeKey: "renewal", themeLabel: "Renovaciones", status: "COLLECTING", title: "DEMO resumen de renovaciones", summary: "Ejemplo sintético para explorar Nora.", recommendation: "Revisar las pólizas próximas a vencer.", plan: "Confirmar datos antes de contactar a un destinatario.", evidenceJson: JSON.stringify({ policyId: policyIds[0] }), detailsJson: JSON.stringify({ synthetic: true }), signalCount: 1, severity: "MEDIUM", firstSignalAt: now, lastSignalAt: now }, create: { id: reportId, organizationId, kind: "DEMO", themeKey: "renewal", themeLabel: "Renovaciones", status: "COLLECTING", title: "DEMO resumen de renovaciones", summary: "Ejemplo sintético para explorar Nora.", recommendation: "Revisar las pólizas próximas a vencer.", plan: "Confirmar datos antes de contactar a un destinatario.", evidenceJson: JSON.stringify({ policyId: policyIds[0] }), detailsJson: JSON.stringify({ synthetic: true }), signalCount: 1, severity: "MEDIUM", firstSignalAt: now, lastSignalAt: now } });
  await tx.assistantReportSignal.upsert({ where: { id: id(organizationId, "assistant-signal", 1) }, update: { organizationId, reportId, signalKind: "RENEWAL", source: "DEMO_SEED", title: "Póliza próxima a vencer", inputJson: JSON.stringify({ policyId: policyIds[0] }), outputJson: JSON.stringify({ synthetic: true }) }, create: { id: id(organizationId, "assistant-signal", 1), organizationId, reportId, signalKind: "RENEWAL", source: "DEMO_SEED", title: "Póliza próxima a vencer", inputJson: JSON.stringify({ policyId: policyIds[0] }), outputJson: JSON.stringify({ synthetic: true }) } });
  const aiRunId = id(organizationId, "assistant-ai-run", 1);
  await tx.assistantAiRun.upsert({ where: { id: aiRunId }, update: { organizationId, userId: actorUserId, userRole: "ADMIN", operation: "DEMO_EXAMPLE", tier: "LOCAL", requestedModel: "demo", finalModel: "demo", status: "SUCCEEDED", attemptCount: 1, fallbackCount: 0, reportId, estimatedCostUsd: 0 }, create: { id: aiRunId, organizationId, userId: actorUserId, userRole: "ADMIN", operation: "DEMO_EXAMPLE", tier: "LOCAL", requestedModel: "demo", finalModel: "demo", status: "SUCCEEDED", attemptCount: 1, fallbackCount: 0, reportId, estimatedCostUsd: 0 } });
  await tx.assistantAiAttempt.upsert({ where: { id: id(organizationId, "assistant-ai-attempt", 1) }, update: { organizationId, runId: aiRunId, attemptNumber: 1, tier: "LOCAL", requestedModel: "demo", finalModel: "demo", status: "SUCCEEDED", provider: "DEMO_SEED" }, create: { id: id(organizationId, "assistant-ai-attempt", 1), organizationId, runId: aiRunId, attemptNumber: 1, tier: "LOCAL", requestedModel: "demo", finalModel: "demo", status: "SUCCEEDED", provider: "DEMO_SEED" } });
  await tx.assistantActionDraft.upsert({ where: { id: id(organizationId, "assistant-draft", 1) }, update: { organizationId, userId: actorUserId, title: "DEMO acción pendiente", summary: "Ejemplo sintético que requiere confirmación.", reply: "No se enviará nada hasta confirmar y reemplazar los datos de contacto.", entityType: "Policy", operation: "REVIEW", targetLabel: "DEMO-AUTO-001", payloadJson: JSON.stringify({ synthetic: true }), status: "PENDING", expiresAt: addDays(now, 7) }, create: { id: id(organizationId, "assistant-draft", 1), organizationId, userId: actorUserId, title: "DEMO acción pendiente", summary: "Ejemplo sintético que requiere confirmación.", reply: "No se enviará nada hasta confirmar y reemplazar los datos de contacto.", entityType: "Policy", operation: "REVIEW", targetLabel: "DEMO-AUTO-001", payloadJson: JSON.stringify({ synthetic: true }), status: "PENDING", expiresAt: addDays(now, 7) } });

  for (const program of BONUS_PROGRAMS) {
    const projection = await calculateBonusProjection(tx as never, organizationId, program, {
      programKey: program.key,
      sellerId: actorUserId,
      year: Number(businessDate.slice(0, 4)),
      periodNumber: program.period === "QUARTERLY" ? 4 : 1,
      ...(program.key.startsWith("DAMAGE_") ? {
        damagePortfolioLossRatio: 0.3,
        damagePortfolioLossRatioAsOf: businessDate,
        damagePortfolioLossRatioSource: `Dato sintético DEMO ${DEMO_SEED_VERSION}; solo para probar la proyección.`,
      } : {}),
    });
    if (projection.status !== "READY" || projection.items.some((item) => item.status === "REVIEW")) {
      throw new Error(`DEMO_SEED_BONUS_PROJECTION_REVIEW:${program.key}:${projection.reviewReasons.join(" | ") || "partida en revisión"}`);
    }
  }
}

export async function validateDemoBaseline(tx: Prisma.TransactionClient, organizationId: string) {
  const now = new Date(`${getBusinessDateKey(new Date())}T12:00:00.000Z`);
  const [clients, policies, receipts, claims, commissions, commissionSnapshots, receiptsMissingCommission, receiptsNeedingCommissionReview, commissionStatementsInReview, commissionStatementRowsInReview, collectionFollowUps, document, describedPolicies, policiesWithoutRiskDetails, unrecognizedPolicyTypes, completePremiumBreakdownPolicies, bonusReadyPolicies, expiredPolicies, renewalsWithinTenDays, paidReceipts, pendingReceipts, overdueReceipts, postedPayments, reversedPayments, cancelledPolicies, cancelledReceipts, resolvedClaims] = await Promise.all([
    tx.client.count({ where: { organizationId } }),
    tx.policy.count({ where: { organizationId } }),
    tx.receipt.count({ where: { organizationId } }),
    tx.claim.count({ where: { organizationId } }),
    tx.commission.count({ where: { organizationId } }),
    tx.commission.count({ where: { organizationId, calculationBreakdownJson: { not: null } } }),
    tx.receipt.count({ where: { organizationId, status: { not: "CANCELLED" }, commissions: { none: { organizationId } } } }),
    tx.receipt.count({ where: { organizationId, status: { not: "CANCELLED" }, commissionCalculationStatus: { in: ["NOT_CALCULATED", "REVIEW"] } } }),
    tx.commissionStatement.count({ where: { organizationId, status: "REVIEW" } }),
    tx.commissionStatementRow.count({ where: { organizationId, status: "REVIEW" } }),
    tx.workItem.count({ where: { organizationId, sourceType: "Collection", title: { startsWith: "Promesa de pago DEMO" } } }),
    tx.document.findUnique({ where: { id: id(organizationId, "document", 1) }, select: { organizationId: true, filePath: true, notes: true } }),
    tx.policy.count({ where: { organizationId, insuredObject: { not: null } } }),
    tx.policy.count({ where: { organizationId, riskDetails: { equals: Prisma.DbNull } } }),
    tx.policy.count({ where: { organizationId, policyType: { notIn: ["AUTO", "GMM", "VIDA", "DANOS", "FIANZAS", "HOGAR", "RESPONSABILIDAD_CIVIL", "EMPRESARIAL", "ACCIDENTES", "OTRO"] } } }),
    tx.policy.count({ where: { organizationId, premiumVatAmount: { not: null }, premiumIssuanceExpenseAmount: { not: null }, premiumSurchargeAmount: { not: null }, premiumDiscountAmount: { not: null } } }),
    tx.policy.count({ where: { organizationId, bonusSellerId: { not: null }, bonusEligibilityJson: { not: null } } }),
    tx.policy.count({ where: { organizationId, status: "EXPIRED" } }),
    tx.policy.count({ where: { organizationId, status: "ACTIVE", endDate: { gte: now, lte: addDays(now, 10) } } }),
    tx.receipt.count({ where: { organizationId, status: "PAID" } }),
    tx.receipt.count({ where: { organizationId, status: "PENDING" } }),
    tx.receipt.count({ where: { organizationId, status: "OVERDUE" } }),
    tx.payment.count({ where: { organizationId, status: "POSTED" } }),
    tx.payment.count({ where: { organizationId, status: "REVERSED" } }),
    tx.policy.count({ where: { organizationId, status: "CANCELLED" } }),
    tx.receipt.count({ where: { organizationId, status: "CANCELLED" } }),
    tx.claim.count({ where: { organizationId, status: "RESOLVED" } }),
  ]);
  const [annualPolicies, semiannualPolicies, quarterlyPolicies, monthlyPolicies] = await Promise.all(["ANNUAL", "SEMIANNUAL", "QUARTERLY", "MONTHLY"].map(paymentFrequency => tx.policy.count({ where: { organizationId, paymentFrequency } })));
  if (
    clients !== 20 || policies !== 40 || receipts !== 191 || annualPolicies !== 10 || semiannualPolicies !== 10 || quarterlyPolicies !== 10 || monthlyPolicies !== 10 || claims < 5 || commissions !== 179 || commissionSnapshots !== commissions || receiptsMissingCommission !== 0 || receiptsNeedingCommissionReview !== 0 || commissionStatementsInReview !== 0 || commissionStatementRowsInReview !== 0 || collectionFollowUps !== 2 ||
    describedPolicies !== 40 || policiesWithoutRiskDetails !== 0 || unrecognizedPolicyTypes !== 0 || completePremiumBreakdownPolicies !== 40 || bonusReadyPolicies !== 40 || expiredPolicies !== 8 || renewalsWithinTenDays !== 1 || paidReceipts !== 176 || pendingReceipts !== 2 || overdueReceipts !== 1 || postedPayments !== 176 || reversedPayments !== 1 ||
    cancelledPolicies !== 1 || cancelledReceipts !== 12 || resolvedClaims !== 1 ||
    document?.organizationId !== organizationId || document.filePath !== `demo://${organizationId}/synthetic/policy-001` || !document.notes?.includes("sintético")
  ) {
    throw new Error("DEMO_SEED_VALIDATION_FAILED");
  }
  return { clients, policies, receipts, receiptSchedules: { ANNUAL: annualPolicies, SEMIANNUAL: semiannualPolicies, QUARTERLY: quarterlyPolicies, MONTHLY: monthlyPolicies }, claims, commissions, commissionSnapshots, receiptsMissingCommission, receiptsNeedingCommissionReview, commissionStatementsInReview, commissionStatementRowsInReview, collectionFollowUps, structuredPolicies: policies - policiesWithoutRiskDetails, completePremiumBreakdownPolicies, bonusReadyPolicies, unrecognizedPolicyTypes, scenarios: { describedPolicies, expiredPolicies, renewalsWithinTenDays, paidReceipts, pendingReceipts, overdueReceipts, postedPayments, reversedPayments, cancelledPolicies, cancelledReceipts, resolvedClaims }, syntheticDocument: true as const };
}
