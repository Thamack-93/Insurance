import { readFile } from "node:fs/promises";

import PDFParser from "pdf2json";

import { SYSTEM_USER_ID } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import { parseDateInput } from "@/lib/form-utils";
import { extractPolicyPdfDraftFromText, suggestPreviousPolicyNumber, type PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";
import { assertProductionMutationAllowed } from "./_shared.ts";

type CliArgs = {
  apply: boolean;
  dryRun: boolean;
};

type SourcePolicy = {
  id: string;
  policyNumber: string;
  clientId: string;
  insurerId: string;
  status: string;
  familyRootId: string | null;
  startDate: Date;
  endDate: Date;
  client: { fullName: string };
  insurer: { name: string };
  insuredAssets: Array<{ serialNumber: string | null }>;
};

type CaptureCase = {
  label: string;
  pdfPath: string;
};

const CASES: CaptureCase[] = [
  {
    label: "19941U01",
    pdfPath: "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes/Adrian Yosef Arellano Regino/Polizas/GMM/2026/Caratula_Renovación_19941U01.pdf",
  },
  {
    label: "0940451814",
    pdfPath: "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes/Charbel Murad Koppel/Polizas/Jeep Cherokee/2026/uv4322190002736879aa.pdf",
  },
];

function parseArgs(argv = process.argv.slice(2)): CliArgs {
  return {
    apply: argv.includes("--apply"),
    dryRun: !argv.includes("--apply"),
  };
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function scoreTextMatch(needle: string, candidate: string) {
  const normalizedNeedle = compact(needle).toLowerCase();
  const normalizedCandidate = compact(candidate).toLowerCase();
  if (!normalizedNeedle || !normalizedCandidate) return 0;
  if (normalizedNeedle === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedCandidate)) return 80;
  const needleTokens = normalizedNeedle.split(/\s+/).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
  const matches = needleTokens.filter((token) =>
    candidateTokens.some((candidateToken) => candidateToken.includes(token) || token.includes(candidateToken)),
  );
  return matches.length * 10;
}

async function parsePdfDraft(pdfPath: string) {
  const file = await readFile(pdfPath);
  const pdfParser = new PDFParser();

  const text = await new Promise<string>((resolve, reject) => {
    pdfParser.on("pdfParser_dataReady", () => {
      resolve(pdfParser.getRawTextContent());
    });
    pdfParser.on("pdfParser_dataError", (errData) => {
      const errorMessage = errData && "parserError" in errData && errData.parserError instanceof Error
        ? errData.parserError.message
        : "PDF parsing failed";
      reject(new Error(errorMessage));
    });
    pdfParser.parseBuffer(Buffer.from(file));
  });

  const draft = extractPolicyPdfDraftFromText(text);
  return { draft, text };
}

function buildCaptureNotes(draft: PolicyPdfCaptureDraft, sourcePolicyNumber: string | null, sourceSerial: string | null) {
  return [
    "Capturada desde PDF.",
    draft.requestNumber ? `Solicitud ${draft.requestNumber}` : null,
    draft.issueDate ? `Emisión ${draft.issueDate}` : null,
    sourcePolicyNumber ? `Renueva ${sourcePolicyNumber}` : null,
    sourceSerial ? `Serie ${sourceSerial}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function resolveActorId(db: ReturnType<typeof getDb>) {
  const pedro = await db.user.findFirst({
    where: { email: "pedroagl93@gmail.com" },
    select: { id: true },
  });
  return pedro?.id ?? SYSTEM_USER_ID;
}

async function resolveSourcePolicy(
  db: ReturnType<typeof getDb>,
  draft: PolicyPdfCaptureDraft,
  targetStartDate: Date,
  exactPolicyNumber: string | null,
): Promise<SourcePolicy> {
  if (exactPolicyNumber) {
    const exact = await db.policy.findFirst({
      where: { policyNumber: exactPolicyNumber },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        insurerId: true,
        status: true,
        familyRootId: true,
        startDate: true,
        endDate: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        insuredAssets: { select: { serialNumber: true } },
      },
    });

    if (exact) return exact;
  }

  if (!draft.serialNumber) {
    const fallback = await db.policy.findFirst({
      where: {
        policyType: draft.policyType,
        client: { fullName: { contains: draft.clientName, mode: "insensitive" } },
        endDate: { lt: targetStartDate },
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
      },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        insurerId: true,
        status: true,
        familyRootId: true,
        startDate: true,
        endDate: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        insuredAssets: { select: { serialNumber: true } },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
    });

    if (fallback) return fallback;

    throw new Error(`No pudimos detectar una serie para sugerir la póliza origen de ${draft.policyNumber}.`);
  }

  const candidates = await db.policy.findMany({
    where: {
      policyType: "AUTO",
      insuredAssets: {
        some: { serialNumber: draft.serialNumber },
      },
      status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
    },
    select: {
      id: true,
      policyNumber: true,
      clientId: true,
      insurerId: true,
      status: true,
      familyRootId: true,
      startDate: true,
      endDate: true,
      client: { select: { fullName: true } },
      insurer: { select: { name: true } },
      insuredAssets: {
        where: { serialNumber: draft.serialNumber },
        select: { serialNumber: true },
        take: 1,
      },
    },
    orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });

  if (!candidates.length) {
    const fallback = await db.policy.findFirst({
      where: {
        policyType: draft.policyType,
        client: { fullName: { contains: draft.clientName, mode: "insensitive" } },
        endDate: { lt: targetStartDate },
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
      },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        insurerId: true,
        status: true,
        familyRootId: true,
        startDate: true,
        endDate: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        insuredAssets: { select: { serialNumber: true } },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
    });

    if (fallback) return fallback;

    throw new Error(`No encontramos una póliza origen con la serie ${draft.serialNumber} para ${draft.policyNumber}.`);
  }

  const scored = candidates
    .map((policy) => ({
      policy,
      score:
        (policy.endDate < targetStartDate ? 20 : 0) +
        scoreTextMatch(draft.clientName, policy.client.fullName) +
        scoreTextMatch(draft.insurerName, policy.insurer.name) +
        (policy.insuredAssets[0]?.serialNumber === draft.serialNumber ? 50 : 0),
    }))
    .sort((left, right) => right.score - left.score || right.policy.endDate.getTime() - left.policy.endDate.getTime());

  return scored[0].policy;
}

async function captureRenewalCase(
  db: ReturnType<typeof getDb>,
  actorId: string,
  captureCase: CaptureCase,
  apply: boolean,
) {
  const { draft } = await parsePdfDraft(captureCase.pdfPath);
  const targetStartDate = parseDateInput(draft.startDate);
  const targetEndDate = parseDateInput(draft.endDate);
  const sourcePolicyNumber =
    captureCase.label === "19941U01"
      ? draft.sourcePolicyNumber ?? suggestPreviousPolicyNumber(draft.policyNumber)
      : draft.sourcePolicyNumber ?? null;
  const sourcePolicy = await resolveSourcePolicy(db, draft, targetStartDate, sourcePolicyNumber);
  const familyRootId = sourcePolicy.familyRootId ?? sourcePolicy.id;

  const existingTarget = await db.policy.findFirst({
    where: {
      policyNumber: draft.policyNumber,
      clientId: sourcePolicy.clientId,
      insurerId: sourcePolicy.insurerId,
      startDate: targetStartDate,
      endDate: targetEndDate,
    },
    select: { id: true, notes: true },
  });

  const notes = buildCaptureNotes(draft, sourcePolicy.policyNumber, draft.serialNumber);
  const policyData = {
    policyNumber: draft.policyNumber,
    clientId: sourcePolicy.clientId,
    insurerId: sourcePolicy.insurerId,
    policyType: draft.policyType,
    status: "ACTIVE",
    startDate: targetStartDate,
    endDate: targetEndDate,
    premiumAmount: draft.premiumAmount,
    currency: draft.currency,
    paymentFrequency: draft.paymentFrequency,
    paymentPlan: draft.paymentPlan,
    insuredObject: draft.insuredObject,
    beneficiaryInfo: draft.beneficiaryInfo,
    notes,
    familyRootId,
    renewedFromPolicyId: sourcePolicy.id,
    updatedById: actorId,
  } as const;

  const summary = {
    label: captureCase.label,
    sourcePolicyNumber: sourcePolicy.policyNumber,
    sourceStatus: sourcePolicy.status,
    sourceSerial: sourcePolicy.insuredAssets[0]?.serialNumber ?? draft.serialNumber,
    targetPolicyNumber: draft.policyNumber,
    policyType: draft.policyType,
    premiumAmount: draft.premiumAmount,
    paymentFrequency: draft.paymentFrequency,
    startDate: draft.startDate,
    endDate: draft.endDate,
    apply,
    action: existingTarget ? "update" : "create",
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const targetPolicy = await db.$transaction(async (tx) => {
    const target = existingTarget
      ? await tx.policy.update({
          where: { id: existingTarget.id },
          data: {
            ...policyData,
            updatedById: actorId,
          },
        })
      : await tx.policy.create({
          data: {
            ...policyData,
            createdById: actorId,
          },
        });

    await tx.policyInsuredParty.deleteMany({ where: { policyId: target.id } });
    await tx.policyInsuredAsset.deleteMany({ where: { policyId: target.id } });

    await tx.policyInsuredParty.create({
      data: {
        policyId: target.id,
        fullName: draft.clientName,
        isPrimary: true,
        sourceLabel: "Captura PDF",
      },
    });

    if (draft.policyType === "AUTO" && draft.serialNumber) {
      await tx.policyInsuredAsset.create({
        data: {
          policyId: target.id,
          assetType: draft.policyType,
          description: draft.insuredObject ?? draft.clientName,
          serialNumber: draft.serialNumber,
          isPrimary: true,
        },
      });
    }

    if (sourcePolicy.status !== "RENEWED") {
      await tx.policy.update({
        where: { id: sourcePolicy.id },
        data: { status: "RENEWED", updatedById: actorId },
      });
    }

    await writeActivityLog({
      entityType: "Policy",
      entityId: target.id,
      action: existingTarget ? "POLICY_CAPTURE_PDF_UPDATE" : "POLICY_CAPTURE_PDF_CREATE",
      oldValue: existingTarget ?? undefined,
      newValue: {
        ...target,
        sourcePolicyId: sourcePolicy.id,
        sourcePolicyNumber: sourcePolicy.policyNumber,
        serialNumber: draft.serialNumber,
        capturedFromPdf: true,
      },
      userId: actorId,
      db: tx,
    });

    await writeActivityLog({
      entityType: "Policy",
      entityId: sourcePolicy.id,
      action: "POLICY_MARK_RENEWED_FROM_PDF",
      oldValue: { status: sourcePolicy.status },
      newValue: { status: "RENEWED", renewedByPolicyId: target.id },
      userId: actorId,
      db: tx,
    });

    return target;
  });

  const appliedSummary = {
    ...summary,
    policyId: targetPolicy.id,
    sourcePolicyId: sourcePolicy.id,
    familyRootId,
  };
  console.log(JSON.stringify(appliedSummary, null, 2));
  return appliedSummary;
}

async function main() {
  const args = parseArgs();
  if (args.apply) {
    assertProductionMutationAllowed({
      actionLabel: "La captura asistida de renovaciones",
      overrideEnv: "ALLOW_CAPTURE_PDF_RENEWALS_PRODUCTION",
    });
  }
  const db = getDb();
  const actorId = await resolveActorId(db);

  try {
    for (const renewalCase of CASES) {
      await captureRenewalCase(db, actorId, renewalCase, args.apply);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Error al capturar pólizas desde PDF.");
  console.error(error);
  process.exit(1);
});
