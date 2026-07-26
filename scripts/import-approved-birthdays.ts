import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import * as XLSX from "@e965/xlsx";

import * as shared from "./_shared.ts";
import { SYSTEM_USER_ID } from "../src/lib/auth.ts";

const { closeDb, createDb, assertProductionMutationAllowed } = shared;

const EXPECTED_APPROVED_COUNT = 38;
const REVIEW_FILE = "/Users/pedrogomez/Desktop/Polizas Pedro/Revision_fechas_nacimiento.xlsx";
const APPLY_CONFIRMATION = "38_APPROVED";

type ImportDecision = "APROBAR" | "CORREGIR" | "RECHAZAR" | "SIN EVIDENCIA";

type ReviewRow = {
  clientId: string;
  clientName: string;
  proposedDate: string | null;
  correctedDate: string | null;
  decision: ImportDecision | "";
  evidenceType: string;
  confidence: string;
  primarySource: string;
  sourcePath: string;
  notes: string;
};

type ParsedArgs = {
  file: string;
  apply: boolean;
  approveAllProposals: boolean;
  allowOverwrite: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => arg.startsWith("--file="));
  return {
    file: fileArg ? fileArg.slice("--file=".length) : REVIEW_FILE,
    apply: args.includes("--apply"),
    approveAllProposals: args.includes("--approve-all-proposals"),
    allowOverwrite: args.includes("--allow-overwrite"),
  };
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const spanish = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (!spanish) return null;
  const [, day, month, year] = spanish;
  const candidate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const check = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

function readReviewRows(filePath: string): ReviewRow[] {
  if (!fs.existsSync(filePath)) throw new Error(`No existe el Excel: ${filePath}`);
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const sheet = workbook.Sheets.Revision;
  if (!sheet) throw new Error("El Excel no contiene la hoja Revision.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((row, index) => {
    const clientId = String(row["Client ID"] ?? "").trim();
    const clientName = String(row.Cliente ?? "").trim();
    const rawDecision = String(row["DECISIÓN"] ?? "").trim().toUpperCase() as ImportDecision;
    const decision = ["APROBAR", "CORREGIR", "RECHAZAR", "SIN EVIDENCIA", ""].includes(rawDecision)
      ? rawDecision
      : "";
    if (!clientId || !clientName) throw new Error(`Fila ${index + 2}: falta Cliente o Client ID.`);
    return {
      clientId,
      clientName,
      proposedDate: parseDate(row["Fecha propuesta"]),
      correctedDate: parseDate(row["Fecha corregida"]),
      decision,
      evidenceType: String(row["Tipo de evidencia"] ?? "").trim(),
      confidence: String(row.Confianza ?? "").trim(),
      primarySource: String(row["Abrir fuente principal"] ?? "").trim(),
      sourcePath: String(row["Ruta relativa fuente"] ?? "").trim(),
      notes: String(row["Notas de revisión"] ?? "").trim(),
    };
  });
}

async function main() {
  const args = parseArgs();
  const rows = readReviewRows(args.file);
  const decisions = rows.map((row) => ({
    ...row,
    decision: row.decision || (args.approveAllProposals && row.proposedDate ? "APROBAR" : "SIN EVIDENCIA"),
  }));
  const importRows = decisions.filter((row) => row.decision === "APROBAR" || row.decision === "CORREGIR");

  if (args.approveAllProposals && importRows.length !== EXPECTED_APPROVED_COUNT) {
    throw new Error(`Se esperaban ${EXPECTED_APPROVED_COUNT} propuestas aprobables y se encontraron ${importRows.length}.`);
  }
  for (const row of importRows) {
    const targetDate = row.decision === "CORREGIR" ? row.correctedDate : row.proposedDate;
    if (!targetDate) throw new Error(`${row.clientName}: ${row.decision} requiere una fecha válida.`);
  }

  const db = createDb();
  try {
    const clients = await db.client.findMany({
      where: { id: { in: importRows.map((row) => row.clientId) } },
      select: { id: true, fullName: true, type: true, status: true, birthDate: true },
    });
    const byId = new Map(clients.map((client) => [client.id, client]));
    const missing = importRows.filter((row) => !byId.has(row.clientId));
    if (missing.length) throw new Error(`Client ID no encontrado: ${missing.map((row) => row.clientId).join(", ")}`);

    for (const row of importRows) {
      const client = byId.get(row.clientId)!;
      if (normalizeName(client.fullName) !== normalizeName(row.clientName)) {
        throw new Error(`No coincide el nombre para ${row.clientId}: Excel="${row.clientName}" Neon="${client.fullName}".`);
      }
      if (client.type !== "PERSON") throw new Error(`${client.fullName} no es PERSON.`);
    }

    const preview = importRows.map((row) => {
      const client = byId.get(row.clientId)!;
      const targetDate = (row.decision === "CORREGIR" ? row.correctedDate : row.proposedDate)!;
      return {
        clientId: row.clientId,
        clientName: client.fullName,
        decision: row.decision,
        oldBirthDate: client.birthDate?.toISOString().slice(0, 10) ?? null,
        newBirthDate: targetDate,
        action: client.birthDate?.toISOString().slice(0, 10) === targetDate ? "SIN CAMBIO" : "ACTUALIZAR SOLO birthDate",
      };
    });

    console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", reviewFile: path.resolve(args.file), count: importRows.length, preview }, null, 2));
    if (!args.apply) return;

    if (process.env.BIRTHDAY_IMPORT_CONFIRM !== APPLY_CONFIRMATION) {
      throw new Error(`Falta BIRTHDAY_IMPORT_CONFIRM=${APPLY_CONFIRMATION} para aplicar.`);
    }
    assertProductionMutationAllowed({
      actionLabel: "Importación de fechas de cumpleaños",
      overrideEnv: "BIRTHDAY_IMPORT_ALLOW_PRODUCTION",
      extraLabels: ["approved birthday review", args.file],
    });
    if (rows.filter((row) => row.decision === "").length && !args.approveAllProposals) {
      throw new Error("Hay decisiones vacías. Usa el Excel completo o --approve-all-proposals con autorización explícita.");
    }

    await db.$transaction(async (tx) => {
      for (const row of importRows) {
        const targetDate = (row.decision === "CORREGIR" ? row.correctedDate : row.proposedDate)!;
        const current = await tx.client.findUnique({ where: { id: row.clientId }, select: { id: true, fullName: true, type: true, birthDate: true } });
        if (!current) throw new Error(`Cliente desapareció durante la transacción: ${row.clientId}`);
        const currentDate = current.birthDate?.toISOString().slice(0, 10) ?? null;
        if (currentDate === targetDate) continue;
        if (currentDate && (!args.allowOverwrite || row.decision !== "CORREGIR")) {
          throw new Error(`${current.fullName} ya tiene birthDate=${currentDate}; solo CORREGIR con --allow-overwrite puede reemplazarlo.`);
        }
        const updated = await tx.client.update({
          where: { id: current.id },
          data: { birthDate: new Date(`${targetDate}T00:00:00.000Z`), updatedById: SYSTEM_USER_ID },
          select: { id: true, birthDate: true },
        });
        await tx.activityLog.create({
          data: {
            entityType: "Client",
            entityId: current.id,
            action: "CLIENT_BIRTHDATE_IMPORTED_FROM_REVIEW",
            oldValue: JSON.stringify({ birthDate: currentDate }),
            newValue: JSON.stringify({
              birthDate: targetDate,
              decision: row.decision,
              reviewFile: path.resolve(args.file),
              sourcePath: row.sourcePath,
              evidenceType: row.evidenceType,
              confidence: row.confidence,
              notes: row.notes,
            }),
            userId: SYSTEM_USER_ID,
          },
        });
        if (!updated.birthDate) throw new Error(`No se confirmó birthDate para ${current.fullName}.`);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
    console.log(JSON.stringify({ applied: importRows.length, audited: importRows.length, skippedNoEvidence: decisions.filter((row) => row.decision === "SIN EVIDENCIA").length }));
  } finally {
    await closeDb(db);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
