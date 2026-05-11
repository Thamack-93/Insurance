#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { writeActivityLog } from "../src/lib/activity-log";
import { getDb } from "../src/lib/db";
import { backupDatabase, ensureDataDirs, exportsDir, getFlag, hasFlag, parseCliArgs, timestampForFile, writeCsv } from "./_shared";
import {
  extractClientNameCandidates,
  extractPolicyNumbers,
  extractReceiptNumbers,
  normalizeMasterKey,
  normalizeMasterName,
  normalizePolicyNumber,
  normalizeReceiptNumber,
  looksLikeClientFolder,
  scanMasterFolder,
} from "../src/lib/master-folder";

type DbClient = {
  id: string;
  fullName: string;
  type: "PERSON" | "COMPANY";
  referidorId: string | null;
};

type FileEvidence = {
  path: string;
  relativePath: string;
  kind: string;
  topLevelFolder: string;
  subjectFolder: string | null;
  referidorFolder: string | null;
  policyNumbers: string[];
  receiptNumbers: string[];
  clientCandidates: string[];
};

type ClientCandidate = {
  name: string;
  normalizedName: string;
  evidenceFiles: Set<string>;
  policyNumbers: Set<string>;
  referidorNames: Set<string>;
  sourceKinds: Set<string>;
  confidence: number;
  matchedDbClientId: string | null;
  matchedDbClientName: string | null;
  suggestedType: "PERSON" | "COMPANY";
};

type PolicyCandidate = {
  normalizedPolicyNumber: string;
  evidenceFiles: Set<string>;
  evidenceKinds: Set<string>;
  clientCandidates: Set<string>;
  referidorCandidates: Set<string>;
  matchedDbPolicyId: string | null;
  matchedDbClientId: string | null;
  matchedDbClientName: string | null;
  insurerName: string | null;
  matchedViaReceipt: boolean;
};

const DEFAULT_MASTER_FOLDER = "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes";
const CLIENT_SCORE_THRESHOLD = 70;

function parseArgs() {
  const parsed = parseCliArgs();
  const rootFolder = parsed.positionals[0] ?? getFlag(parsed, "folder", DEFAULT_MASTER_FOLDER) ?? DEFAULT_MASTER_FOLDER;
  const outPath = getFlag(parsed, "out");
  const dryRun = !hasFlag(parsed, "apply");

  return { rootFolder, outPath, dryRun };
}

function guessClientType(name: string): "PERSON" | "COMPANY" {
  const normalized = normalizeMasterName(name);
  if (
    /\b(SA|S\.A\.|SACV|SC|S\.C\.|SAPI|CV|S\.DE\.R\.L\.)\b/i.test(name) ||
    /\b(GRUPO|LOGISTICA|LOGÍSTICA|SERVICIOS|INTEGRAL|TALLER|DESARROLLO|DESARROLLOS|HOLDING|CORP|CORPORATIVO|EMPRESARIAL|COMERCIAL|INDUSTRIAL|INMOBILIARIA|CONSTRUCTORA|AUTOS|TRANSPORTES)\b/i.test(normalized)
  ) {
    return "COMPANY";
  }

  return "PERSON";
}

function confidenceForSource(kind: string, isPrimaryFolder: boolean) {
  if (kind === "folder-subject") return 60;
  if (kind === "folder-top") return 45;
  if (kind === "text-marker") return 40;
  if (kind === "text-line") return 25;
  if (kind === "xml-tag") return 45;
  if (kind === "file-name") return 20;
  return isPrimaryFolder ? 30 : 15;
}

function addClientCandidate(
  candidates: Map<string, ClientCandidate>,
  name: string,
  options: {
    sourceKind: string;
    filePath: string;
    policyNumber?: string;
    referidorName?: string | null;
    primaryFolder?: boolean;
  },
) {
  const displayName = name.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeMasterName(displayName);
  if (!normalizedName) return;

  const existing = candidates.get(normalizedName) ?? {
    name: displayName,
    normalizedName,
    evidenceFiles: new Set<string>(),
    policyNumbers: new Set<string>(),
    referidorNames: new Set<string>(),
    sourceKinds: new Set<string>(),
    confidence: 0,
    matchedDbClientId: null,
    matchedDbClientName: null,
    suggestedType: guessClientType(normalizedName),
  };

  existing.evidenceFiles.add(options.filePath);
  existing.sourceKinds.add(options.sourceKind);
  if (options.policyNumber) existing.policyNumbers.add(options.policyNumber);
  if (options.referidorName) {
    const referidor = normalizeMasterName(options.referidorName);
    if (referidor && referidor !== normalizedName) {
      existing.referidorNames.add(referidor);
    }
  }
  existing.confidence = Math.min(100, existing.confidence + confidenceForSource(options.sourceKind, options.primaryFolder ?? false));

  candidates.set(normalizedName, existing);
}

function addPolicyCandidate(
  candidates: Map<string, PolicyCandidate>,
  policyNumber: string,
  options: {
    filePath: string;
    kind: string;
    clientName?: string | null;
    referidorName?: string | null;
    matchedViaReceipt?: boolean;
    insurerName?: string | null;
  },
) {
  const normalized = normalizePolicyNumber(policyNumber);
  if (!normalized) return;

  const existing = candidates.get(normalized) ?? {
    normalizedPolicyNumber: normalized,
    evidenceFiles: new Set<string>(),
    evidenceKinds: new Set<string>(),
    clientCandidates: new Set<string>(),
    referidorCandidates: new Set<string>(),
    matchedDbPolicyId: null,
    matchedDbClientId: null,
    matchedDbClientName: null,
    insurerName: options.insurerName ? normalizeMasterName(options.insurerName) : null,
    matchedViaReceipt: false,
  };

  existing.evidenceFiles.add(options.filePath);
  existing.evidenceKinds.add(options.kind);
  if (options.clientName) existing.clientCandidates.add(normalizeMasterName(options.clientName));
  if (options.referidorName) existing.referidorCandidates.add(normalizeMasterName(options.referidorName));
  if (options.insurerName && !existing.insurerName) existing.insurerName = normalizeMasterName(options.insurerName);
  existing.matchedViaReceipt = existing.matchedViaReceipt || Boolean(options.matchedViaReceipt);

  candidates.set(normalized, existing);
}

async function readEvidenceText(filePath: string, kind: string) {
  if (kind === "pdf") {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text ?? "";
  }

  if (kind === "xml") {
    return fs.readFile(filePath, "utf8");
  }

  return "";
}

function extractNamesFromXml(xml: string) {
  const candidates = new Map<string, string>();
  const regexes = [
    /<(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre)>([^<]{3,120})<\/(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre)>/gi,
    /(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre)\s*=\s*"([^"]{3,120})"/gi,
  ];

  for (const regex of regexes) {
    for (const match of xml.matchAll(regex)) {
      const candidate = (match[1] ?? "").trim().replace(/\s+/g, " ");
      const normalized = normalizeMasterName(candidate);
      if (normalized && candidate.length >= 4 && !candidates.has(normalized)) {
        candidates.set(normalized, candidate);
      }
    }
  }

  return Array.from(candidates.values());
}

async function main() {
  const { rootFolder, outPath, dryRun } = parseArgs();
  const db = getDb();

  await ensureDataDirs();

  const [dbClients, dbPolicies, dbReceipts] = await Promise.all([
    db.client.findMany({
      select: {
        id: true,
        fullName: true,
        type: true,
        referidorId: true,
      },
    }),
    db.policy.findMany({
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
    }),
    db.receipt.findMany({
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
      },
    }),
  ]);

  const dbClientByName = new Map(dbClients.map((client) => [normalizeMasterName(client.fullName), client]));
  const dbPolicyByNumber = new Map(dbPolicies.map((policy) => [normalizePolicyNumber(policy.policyNumber), policy]));
  const dbReceiptByNumber = new Map(dbReceipts.map((receipt) => [normalizeReceiptNumber(receipt.receiptNumber), receipt]));

  const files = await scanMasterFolder(rootFolder);

  const fileEvidence: FileEvidence[] = [];
  const policyCandidates = new Map<string, PolicyCandidate>();
  const clientCandidates = new Map<string, ClientCandidate>();

  for (const file of files) {
    const text = await readEvidenceText(file.absolutePath, file.kind);
    const policyNumbers = new Set<string>([
      ...extractPolicyNumbers(text),
      ...extractPolicyNumbers(file.fileName, "path"),
      ...extractPolicyNumbers(file.relativePath, "path"),
    ].map((value) => normalizePolicyNumber(value)));
    const receiptNumbers = new Set<string>([
      ...extractReceiptNumbers(text),
      ...extractReceiptNumbers(file.fileName, "path"),
      ...extractReceiptNumbers(file.relativePath, "path"),
    ].map((value) => normalizeReceiptNumber(value)));
    const textClientCandidates = new Map<string, string>();
    for (const candidate of [...extractClientNameCandidates(text), ...extractNamesFromXml(text)]) {
      const displayName = candidate.trim().replace(/\s+/g, " ");
      const key = normalizeMasterName(displayName);
      if (key && !textClientCandidates.has(key)) {
        textClientCandidates.set(key, displayName);
      }
    }

    const folderCandidateEntries: Array<{ key: string; value: string; sourceKind: "folder-top" | "folder-subject" }> = [];
    if (file.subjectFolder && looksLikeClientFolder(file.subjectFolder)) {
      folderCandidateEntries.push({
        key: normalizeMasterName(file.subjectFolder),
        value: file.subjectFolder,
        sourceKind: "folder-subject",
      });
    }
    if (looksLikeClientFolder(file.topLevelFolder)) {
      const topLevelKey = normalizeMasterName(file.topLevelFolder);
      const subjectKey = file.subjectFolder ? normalizeMasterName(file.subjectFolder) : null;
      if (!subjectKey || subjectKey !== topLevelKey) {
        folderCandidateEntries.push({
          key: topLevelKey,
          value: file.topLevelFolder,
          sourceKind: "folder-top",
        });
      }
    }

    const folderClientCandidates = new Map(folderCandidateEntries.map((entry) => [entry.key, entry.value]));

    const referidorName = file.subjectFolder
      && file.topLevelFolder
      && looksLikeClientFolder(file.topLevelFolder)
      && normalizeMasterKey(file.subjectFolder) !== normalizeMasterKey(file.topLevelFolder)
      ? file.topLevelFolder
      : null;

    const allClientCandidates = new Map<string, string>();
    for (const [key, value] of folderClientCandidates.entries()) {
      if (!allClientCandidates.has(key)) allClientCandidates.set(key, value);
    }
    for (const [key, value] of textClientCandidates.entries()) {
      if (!allClientCandidates.has(key)) allClientCandidates.set(key, value);
    }

    const bestClientName = [
      ...textClientCandidates.entries(),
      ...folderCandidateEntries.map((entry) => [entry.key, entry.value] as const),
    ].find(([key]) => dbClientByName.has(key))?.[1] ?? Array.from(allClientCandidates.values())[0] ?? null;

    for (const policyNumber of policyNumbers) {
      addPolicyCandidate(policyCandidates, policyNumber, {
        filePath: file.absolutePath,
        kind: file.kind,
        clientName: bestClientName,
        referidorName,
        matchedViaReceipt: false,
      });

      const dbPolicy = dbPolicyByNumber.get(policyNumber);
      if (dbPolicy) {
        const policyCandidate = policyCandidates.get(policyNumber);
        if (policyCandidate) {
          policyCandidate.matchedDbPolicyId = dbPolicy.id;
          policyCandidate.matchedDbClientId = dbPolicy.clientId;
          policyCandidate.matchedDbClientName = dbPolicy.client.fullName;
          policyCandidate.insurerName = dbPolicy.insurer.name;
        }
      }
    }

    for (const receiptNumber of receiptNumbers) {
      const dbReceipt = dbReceiptByNumber.get(receiptNumber);
      if (!dbReceipt) continue;
      const dbPolicy = dbPolicies.find((policy) => policy.id === dbReceipt.policyId);
      if (!dbPolicy) continue;
      addPolicyCandidate(policyCandidates, dbPolicy.policyNumber, {
        filePath: file.absolutePath,
        kind: `${file.kind}-receipt`,
        clientName: bestClientName,
        referidorName,
        matchedViaReceipt: true,
        insurerName: dbPolicy.insurer.name,
      });
      const policyCandidate = policyCandidates.get(normalizePolicyNumber(dbPolicy.policyNumber));
      if (policyCandidate) {
        policyCandidate.matchedDbPolicyId = dbPolicy.id;
        policyCandidate.matchedDbClientId = dbPolicy.clientId;
        policyCandidate.matchedDbClientName = dbPolicy.client.fullName;
        policyCandidate.insurerName = dbPolicy.insurer.name;
      }
    }

    for (const [clientKey, clientName] of allClientCandidates.entries()) {
      addClientCandidate(clientCandidates, clientName, {
        sourceKind: folderClientCandidates.has(clientKey)
          ? (folderCandidateEntries.find((entry) => entry.key === clientKey)?.sourceKind ?? "folder-top")
          : "text-marker",
        filePath: file.absolutePath,
        policyNumber: Array.from(policyNumbers)[0],
        referidorName,
        primaryFolder: folderClientCandidates.has(clientKey),
      });
    }

    fileEvidence.push({
      path: file.absolutePath,
      relativePath: file.relativePath,
      kind: file.kind,
      topLevelFolder: file.topLevelFolder,
      subjectFolder: file.subjectFolder,
      referidorFolder: file.referidorFolder,
      policyNumbers: Array.from(policyNumbers),
      receiptNumbers: Array.from(receiptNumbers),
      clientCandidates: Array.from(allClientCandidates.values()),
    });
  }

  const policyRows = Array.from(policyCandidates.values()).map((candidate) => {
    const dbPolicy = candidate.matchedDbPolicyId ? dbPolicies.find((policy) => policy.id === candidate.matchedDbPolicyId) : null;
    const status = dbPolicy ? "MATCHED" : "MISSING";
    return {
      policyNumber: candidate.normalizedPolicyNumber,
      status,
      matchedClient: dbPolicy?.client.fullName ?? candidate.matchedDbClientName ?? "",
      insurer: dbPolicy?.insurer.name ?? candidate.insurerName ?? "",
      evidenceFiles: Array.from(candidate.evidenceFiles).join(" | "),
      matchedViaReceipt: candidate.matchedViaReceipt ? "YES" : "NO",
      clientCandidates: Array.from(candidate.clientCandidates).join(" | "),
      referidorCandidates: Array.from(candidate.referidorCandidates).join(" | "),
    };
  });

  const discoveredClientRows = Array.from(clientCandidates.values()).map((candidate) => {
    const dbClient = dbClientByName.get(candidate.normalizedName) ?? null;
    if (dbClient && !candidate.matchedDbClientId) {
      candidate.matchedDbClientId = dbClient.id;
      candidate.matchedDbClientName = dbClient.fullName;
    }

    const referidorMatches = Array.from(candidate.referidorNames)
      .map((name) => dbClientByName.get(name))
      .filter(Boolean) as DbClient[];

    const uniqueReferidorIds = new Set(referidorMatches.map((item) => item.id));
    const status = dbClient ? "MATCHED" : candidate.confidence >= CLIENT_SCORE_THRESHOLD ? "DISCOVERED" : "AMBIGUOUS";

    return {
      name: candidate.name,
      status,
      matchedClient: dbClient?.fullName ?? "",
      confidence: candidate.confidence,
      suggestedType: candidate.suggestedType,
      referidorCandidates: Array.from(candidate.referidorNames).join(" | "),
      resolvedReferidor: uniqueReferidorIds.size === 1 ? Array.from(uniqueReferidorIds)[0] : "",
      evidenceFiles: Array.from(candidate.evidenceFiles).join(" | "),
      policyNumbers: Array.from(candidate.policyNumbers).join(" | "),
      sourceKinds: Array.from(candidate.sourceKinds).join(" | "),
    };
  });

  const missingPolicies = dbPolicies
    .filter((policy) => !policyCandidates.has(normalizePolicyNumber(policy.policyNumber)))
    .map((policy) => ({
      policyNumber: policy.policyNumber,
      client: policy.client.fullName,
      insurer: policy.insurer.name,
    }));

  const matchedPolicies = policyRows.filter((row) => row.status === "MATCHED");
  const missingPolicyRows = policyRows.filter((row) => row.status === "MISSING");
  const discoveredClientRowsFiltered = discoveredClientRows.filter((row) => row.status !== "MATCHED");

  const reportTimestamp = timestampForFile();
  const reportBaseName = `master-folder-reconciliation-${reportTimestamp}`;
  const reportDir = exportsDir;
  const resolvedReportBase = outPath ? path.resolve(outPath) : path.join(reportDir, reportBaseName);
  const reportJsonPath = resolvedReportBase.endsWith(".json") ? resolvedReportBase : `${resolvedReportBase}.json`;
  const reportMdPath = resolvedReportBase.endsWith(".md") ? resolvedReportBase : `${resolvedReportBase}.md`;
  const matchedCsvPath = `${resolvedReportBase}-matched-policies.csv`;
  const missingCsvPath = `${resolvedReportBase}-missing-policies.csv`;
  const clientsCsvPath = `${resolvedReportBase}-client-candidates.csv`;

  await ensureDataDirs();
  await fs.writeFile(
    reportJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rootFolder,
        dryRun,
        fileCount: files.length,
        dbCounts: {
          clients: dbClients.length,
          policies: dbPolicies.length,
          receipts: dbReceipts.length,
        },
        policyMatches: matchedPolicies.length,
        missingPolicyCandidates: missingPolicyRows.length,
        databasePoliciesWithoutFolderEvidence: missingPolicies.length,
        discoveredClients: discoveredClientRowsFiltered.length,
        files: fileEvidence,
      },
      null,
      2,
    ),
    "utf8",
  );

  const markdown = [
    "# Master Folder Reconciliation",
    "",
    `- Root folder: \`${rootFolder}\``,
    `- Generated at: ${new Date().toISOString()}`,
    `- Mode: ${dryRun ? "read-only" : "apply-missing-clients"}`,
    "",
    "## Summary",
    "",
    `- Files scanned: ${files.length}`,
    `- Database clients: ${dbClients.length}`,
    `- Database policies: ${dbPolicies.length}`,
    `- Database receipts: ${dbReceipts.length}`,
    `- Matched policies: ${matchedPolicies.length}`,
    `- Policy candidates not in DB: ${missingPolicyRows.length}`,
    `- DB policies without folder evidence: ${missingPolicies.length}`,
    `- New client candidates: ${discoveredClientRowsFiltered.length}`,
    "",
    "## Notes",
    "",
    "- Top-level folder names are treated as referidor/groupers when nested subject folders or document evidence suggest another insured client.",
    "- The report is read-only by default. Use `--apply` only after reviewing the CSV/JSON outputs.",
    "- A client candidate is only auto-created when the signal is strong enough and the candidate does not already exist in `pg.sqlite`.",
    "",
    "## Next review queue",
    "",
    ...missingPolicyRows.slice(0, 20).map((row) => `- Missing policy: ${row.policyNumber} · ${row.client} · ${row.insurer}`),
    ...(missingPolicyRows.length > 20 ? [`- ... y ${missingPolicyRows.length - 20} más`] : []),
  ].join("\n");

  await fs.writeFile(reportMdPath, markdown, "utf8");

  await writeCsv(matchedCsvPath, matchedPolicies);
  await writeCsv(missingCsvPath, missingPolicyRows);
  await writeCsv(clientsCsvPath, discoveredClientRowsFiltered);

  if (!dryRun) {
    const backupPath = await backupDatabase();
    if (backupPath) {
      console.log(`Backup creado: ${backupPath}`);
    }

    let createdClients = 0;

    for (const candidate of clientCandidates.values()) {
      if (candidate.matchedDbClientId || candidate.confidence < CLIENT_SCORE_THRESHOLD) {
        continue;
      }

      const referidorMatches = Array.from(candidate.referidorNames)
        .map((name) => dbClientByName.get(name))
        .filter(Boolean) as DbClient[];
      const uniqueReferidorIds = Array.from(new Set(referidorMatches.map((item) => item.id)));
      const existingReferidorId = uniqueReferidorIds.length === 1 ? uniqueReferidorIds[0] : null;
      const existing = dbClientByName.get(candidate.normalizedName) ?? null;

      if (existing) {
        continue;
      }

      const created = await db.client.create({
        data: {
          fullName: candidate.name,
          type: candidate.suggestedType,
          status: "ACTIVE",
          referidorId: existingReferidorId ?? null,
          notes: existingReferidorId
            ? "Creado desde conciliacion de carpeta maestra."
            : `Creado desde conciliacion de carpeta maestra. Referidor pendiente: ${Array.from(candidate.referidorNames).join(", ") || "no detectado"}.`,
        },
      });

      await writeActivityLog({
        entityType: "Client",
        entityId: created.id,
        action: "CLIENT_CREATE_FROM_MASTER_FOLDER",
        newValue: {
          fullName: candidate.name,
          referidorId: existingReferidorId,
          confidence: candidate.confidence,
          sourceKinds: Array.from(candidate.sourceKinds),
        },
      });

      createdClients += 1;
    }

    console.log(`Clientes creados desde conciliacion: ${createdClients}`);
  }

  console.log("Conciliacion de carpeta maestra completada.");
  console.log(`Informe JSON: ${reportJsonPath}`);
  console.log(`Informe MD: ${reportMdPath}`);
  console.log(`CSV coincidencias: ${matchedCsvPath}`);
  console.log(`CSV faltantes: ${missingCsvPath}`);
  console.log(`CSV clientes: ${clientsCsvPath}`);
  console.log("");
  console.log(`Pólizas en carpeta detectadas: ${matchedPolicies.length + missingPolicyRows.length}`);
  console.log(`Pólizas coincidentes: ${matchedPolicies.length}`);
  console.log(`Pólizas faltantes en DB: ${missingPolicyRows.length}`);
  console.log(`Pólizas en DB sin evidencia en carpeta: ${missingPolicies.length}`);
  console.log(`Clientes candidatos nuevos: ${discoveredClientRowsFiltered.length}`);
  console.log(`Modo: ${dryRun ? "solo lectura" : "aplicar clientes nuevos"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
