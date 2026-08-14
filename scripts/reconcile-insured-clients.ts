import fs from "node:fs/promises";
import path from "node:path";

import { getDb, resetDb } from "@/lib/db";
import { assertProductionMutationAllowed, parseCliArgs, requireOrganizationId } from "./_shared.ts";
import {
  isInsuredClientName,
  mergeTextField,
  normalizePersonKey,
  splitInsuredClientName,
} from "@/lib/insured-client-consolidation";

type CandidateClient = {
  id: string;
  fullName: string;
  type: string;
  status: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  rfc: string | null;
  address: string | null;
  preferredContactMethod: string | null;
  notes: string | null;
  portfolioOwnerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    policies: number;
    receipts: number;
    payments: number;
    commissions: number;
    claims: number;
    quotes: number;
    documents: number;
    workItems: number;
    notificationEvents: number;
    referidos: number;
  };
};

type CanonicalClient = CandidateClient;

type ClientPolicy = {
  id: string;
  policyNumber: string;
  status: string;
  policyType: string;
  insurer: { name: string };
};

type ReportRow = {
  clientId: string;
  client: string;
  canonicalClientId: string | null;
  canonicalClient: string | null;
  contractorName: string;
  insuredName: string;
  policyCount: number;
  gmmPolicyCount: number;
  activePolicyCount: number;
  policies: string;
  action: string;
  notes: string;
};

function timestampForFile(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function normalizePolicyType(value: string) {
  return value.trim().toUpperCase();
}

function isGmmPolicy(policy: ClientPolicy) {
  return normalizePolicyType(policy.policyType).includes("GMM");
}

function pickCanonicalClient(clients: CanonicalClient[], contractorName: string) {
  const normalized = normalizePersonKey(contractorName);
  const matches = clients.filter((client) => normalizePersonKey(client.fullName) === normalized);

  if (!matches.length) return null;

  return [...matches].sort((left, right) => {
    const leftMarker = isInsuredClientName(left.fullName) ? 1 : 0;
    const rightMarker = isInsuredClientName(right.fullName) ? 1 : 0;
    if (leftMarker !== rightMarker) return leftMarker - rightMarker;

    const leftActive = left.status === "ACTIVE" ? 1 : 0;
    const rightActive = right.status === "ACTIVE" ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;

    const leftScore = left._count.policies + left._count.receipts + left._count.payments + left._count.commissions + left._count.claims + left._count.quotes + left._count.documents + left._count.workItems + left._count.notificationEvents + left._count.referidos;
    const rightScore = right._count.policies + right._count.receipts + right._count.payments + right._count.commissions + right._count.claims + right._count.quotes + right._count.documents + right._count.workItems + right._count.notificationEvents + right._count.referidos;
    if (leftScore !== rightScore) return rightScore - leftScore;

    return left.createdAt.getTime() - right.createdAt.getTime();
  })[0]!;
}

function mergeClientMetadata(target: CanonicalClient, source: CandidateClient) {
  return {
    type: target.type === "PERSON" && source.type !== "PERSON" ? source.type : target.type,
    email: mergeTextField(target.email, source.email),
    phone: mergeTextField(target.phone, source.phone),
    secondaryPhone: mergeTextField(target.secondaryPhone, source.secondaryPhone),
    rfc: mergeTextField(target.rfc, source.rfc),
    address: mergeTextField(target.address, source.address),
    preferredContactMethod: mergeTextField(target.preferredContactMethod, source.preferredContactMethod),
    notes: mergeTextField(target.notes, source.notes),
    portfolioOwnerId: target.portfolioOwnerId ?? source.portfolioOwnerId,
  };
}

function appendConsolidationNote(current: string | null, details: string) {
  const note = `Consolidado desde ${details}`;
  if (!current?.trim()) return note;
  if (current.includes(note)) return current;
  return `${current.trim()}\n\n${note}`;
}

async function writeReportFile(rows: ReportRow[], summary: Record<string, unknown>) {
  const reportDir = path.join(process.cwd(), "exports", "insured-client-consolidation");
  await fs.mkdir(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `reconciliation-${timestampForFile()}.json`);
  await fs.writeFile(filePath, JSON.stringify({ summary, rows }, null, 2), "utf8");
  return filePath;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const organizationId = requireOrganizationId(parseCliArgs());
  if (apply) {
    assertProductionMutationAllowed({
      actionLabel: "La reconciliación de clientes asegurados",
      overrideEnv: "ALLOW_INSURED_CLIENT_RECONCILIATION_PRODUCTION",
    });
  }
  const db = getDb();

  const [allClients, candidateClients, policies] = await Promise.all([
    db.client.findMany({
      where: { organizationId },
      select: {
        id: true,
        fullName: true,
        type: true,
        status: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        rfc: true,
        address: true,
        preferredContactMethod: true,
        notes: true,
        portfolioOwnerId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            policies: true,
            receipts: true,
            payments: true,
            commissions: true,
            claims: true,
            quotes: true,
            documents: true,
            workItems: true,
            notificationEvents: true,
            referidos: true,
          },
        },
      },
      orderBy: { fullName: "asc" },
    }),
    db.client.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        fullName: { contains: "ASEGURADO:" },
      },
      select: {
        id: true,
        fullName: true,
        type: true,
        status: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        rfc: true,
        address: true,
        preferredContactMethod: true,
        notes: true,
        portfolioOwnerId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            policies: true,
            receipts: true,
            payments: true,
            commissions: true,
            claims: true,
            quotes: true,
            documents: true,
            workItems: true,
            notificationEvents: true,
            referidos: true,
          },
        },
      },
      orderBy: { fullName: "asc" },
    }),
    db.policy.findMany({
      where: { organizationId },
      select: {
        id: true,
        policyNumber: true,
        status: true,
        policyType: true,
        clientId: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
      orderBy: [{ clientId: "asc" }, { policyNumber: "asc" }],
    }),
  ]);

  const policyMap = new Map<string, ClientPolicy[]>();
  for (const policy of policies) {
    const list = policyMap.get(policy.clientId) ?? [];
    list.push(policy);
    policyMap.set(policy.clientId, list);
  }

  const rows: ReportRow[] = [];
  const ambiguous: string[] = [];
  const skipped: string[] = [];
  let mergedCount = 0;

  for (const candidate of candidateClients) {
    const parts = splitInsuredClientName(candidate.fullName);
    const canonical = pickCanonicalClient(allClients, parts.contractorName);

    if (!canonical) {
      skipped.push(`${candidate.fullName}: no encontré cliente canónico para ${parts.contractorName}`);
      rows.push({
        clientId: candidate.id,
        client: candidate.fullName,
        canonicalClientId: null,
        canonicalClient: null,
        contractorName: parts.contractorName,
        insuredName: parts.insuredName,
        policyCount: candidate._count.policies,
        gmmPolicyCount: 0,
        activePolicyCount: 0,
        policies: "",
        action: "SKIPPED",
        notes: "No se encontró cliente canónico para consolidar.",
      });
      continue;
    }

    const canonicalPolicies = policyMap.get(canonical.id) ?? [];
    const sourcePolicies = policyMap.get(candidate.id) ?? [];
    const combinedPolicies = candidate.id === canonical.id ? canonicalPolicies : [...canonicalPolicies, ...sourcePolicies];
    const combinedPoliciesUnique = [...new Map(combinedPolicies.map((policy) => [policy.id, policy] as const)).values()];
    const activePolicies = combinedPoliciesUnique.filter((policy) => policy.status === "ACTIVE");
    const gmmPolicies = combinedPoliciesUnique.filter(isGmmPolicy);
    const policySummary = (gmmPolicies.length ? gmmPolicies : combinedPoliciesUnique).map(
      (policy) => `${policy.policyNumber} [${policy.policyType}] ${policy.status} · ${policy.insurer.name}`,
    );

    if (candidate.id === canonical.id) {
      skipped.push(`${candidate.fullName}: el cliente ya es el canónico`);
      rows.push({
        clientId: candidate.id,
        client: candidate.fullName,
        canonicalClientId: canonical.id,
        canonicalClient: canonical.fullName,
        contractorName: parts.contractorName,
        insuredName: parts.insuredName,
        policyCount: combinedPoliciesUnique.length,
        gmmPolicyCount: gmmPolicies.length,
        activePolicyCount: activePolicies.length,
        policies: policySummary.join(" | "),
        action: "SKIPPED",
        notes: "El registro ya coincide con el cliente canónico.",
      });
      continue;
    }

    if (!apply) {
      rows.push({
        clientId: candidate.id,
        client: candidate.fullName,
        canonicalClientId: canonical.id,
        canonicalClient: canonical.fullName,
        contractorName: parts.contractorName,
        insuredName: parts.insuredName,
        policyCount: combinedPoliciesUnique.length,
        gmmPolicyCount: gmmPolicies.length,
        activePolicyCount: activePolicies.length,
        policies: policySummary.join(" | "),
        action: "PREVIEW_MERGE",
        notes: canonical.fullName === candidate.fullName ? "Coincidencia exacta." : "Se consolidará en el cliente canónico.",
      });
      continue;
    }

    try {
      await db.$transaction(async (tx) => {
        const currentCanonical = await tx.client.findFirst({
          where: { id: canonical.id, organizationId },
          select: {
            id: true,
            fullName: true,
            type: true,
            status: true,
            email: true,
            phone: true,
            secondaryPhone: true,
            rfc: true,
            address: true,
            preferredContactMethod: true,
            notes: true,
            portfolioOwnerId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                policies: true,
                receipts: true,
                payments: true,
                commissions: true,
                claims: true,
                quotes: true,
                documents: true,
                workItems: true,
                notificationEvents: true,
                referidos: true,
              },
            },
          },
        });

        if (!currentCanonical) {
          throw new Error(`No se pudo recargar el cliente canónico ${canonical.fullName}.`);
        }

        const mergedMetadata = mergeClientMetadata(currentCanonical, candidate);
        const mergedNote = appendConsolidationNote(
          currentCanonical.notes,
          `${candidate.fullName} (${parts.insuredName})`,
        );

        await tx.client.update({
          where: { id: currentCanonical.id, organizationId },
          data: {
            ...mergedMetadata,
            notes: mergedNote,
            status: "ACTIVE",
            updatedAt: new Date(),
          },
        });

        await tx.policy.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.receipt.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.payment.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.commission.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.claim.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.quote.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.document.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.task.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.workItem.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.notificationEvent.updateMany({ where: { organizationId, clientId: candidate.id }, data: { clientId: currentCanonical.id } });
        await tx.client.updateMany({ where: { organizationId, referidorId: candidate.id }, data: { referidorId: currentCanonical.id } });

        await tx.client.update({
          where: { id: candidate.id, organizationId },
          data: {
            status: "ARCHIVED",
            notes: appendConsolidationNote(candidate.notes, `fusionado con ${currentCanonical.fullName}`),
          },
        });
      });

      mergedCount += 1;
      rows.push({
        clientId: candidate.id,
        client: candidate.fullName,
        canonicalClientId: canonical.id,
        canonicalClient: canonical.fullName,
        contractorName: parts.contractorName,
        insuredName: parts.insuredName,
        policyCount: combinedPoliciesUnique.length,
        gmmPolicyCount: gmmPolicies.length,
        activePolicyCount: activePolicies.length,
        policies: policySummary.join(" | "),
        action: "MERGED_AND_ARCHIVED",
        notes: `Consolidado en ${canonical.fullName}.`,
      });
    } catch (error) {
      ambiguous.push(`${candidate.fullName}: ${(error as Error).message}`);
      rows.push({
        clientId: candidate.id,
        client: candidate.fullName,
        canonicalClientId: canonical.id,
        canonicalClient: canonical.fullName,
        contractorName: parts.contractorName,
        insuredName: parts.insuredName,
        policyCount: combinedPoliciesUnique.length,
        gmmPolicyCount: gmmPolicies.length,
        activePolicyCount: activePolicies.length,
        policies: policySummary.join(" | "),
        action: "ERROR",
        notes: (error as Error).message,
      });
    }
  }

  const summary = {
    mode: apply ? "apply" : "preview",
    totalCandidates: candidateClients.length,
    mergedCount,
    skippedCount: skipped.length,
    ambiguousCount: ambiguous.length,
    gmmCandidates: rows.filter((row) => row.gmmPolicyCount > 0).length,
  };

  const reportPath = await writeReportFile(rows, summary);

  console.log(JSON.stringify({ summary, reportPath, ambiguous, skipped }, null, 2));

  await resetDb();
}

main().catch(async (error) => {
  console.error(error);
  await resetDb();
  process.exitCode = 1;
});
