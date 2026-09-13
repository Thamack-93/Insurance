import "server-only";

import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "@e965/xlsx";
import { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";

export type CommissionDraftRow = { rowKey: string; policyNumber?: string; receiptNumber?: string; currency?: string; amount?: number; paymentDate?: string; sourcePage?: number; raw: Record<string, unknown>; warnings: string[] };

function text(value: unknown) { return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim(); }
function money(value: unknown) { const normalized = text(value).replace(/[^\d,.-]/g, "").replace(/,(?=\d{2}$)/, ".").replace(/,/g, ""); const result = Number(normalized); return Number.isFinite(result) ? result : undefined; }
function date(value: unknown) { const parsed = new Date(text(value)); return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString(); }

export function parseCommissionStatement(buffer: Buffer, mimeType: string): CommissionDraftRow[] {
  let records: Array<Record<string, unknown>> = [];
  if (mimeType.includes("csv") || mimeType.includes("text")) records = parseCsv(buffer.toString("utf8"), { columns: true, skip_empty_lines: true, bom: true }) as Array<Record<string, unknown>>;
  else {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  }
  return records.map((raw, index) => {
    const find = (keys: string[]) => keys.map((key) => raw[key] ?? raw[Object.keys(raw).find((candidate) => candidate.toLowerCase().includes(key)) ?? ""]).find((value) => text(value));
    const policyNumber = text(find(["policy", "póliza", "poliza"])) || undefined;
    const receiptNumber = text(find(["receipt", "recibo"])) || undefined;
    const currency = text(find(["currency", "moneda"])) || undefined;
    const amount = money(find(["amount", "importe", "commission", "comisión"]));
    const paymentDate = date(find(["payment", "fecha"]));
    const warnings = [...(!policyNumber && !receiptNumber ? ["Falta identidad de póliza o recibo."] : []), ...(amount === undefined ? ["Importe no reconocido."] : []), ...(currency ? [] : ["Moneda no especificada."] )];
    return { rowKey: `${index + 1}`, policyNumber, receiptNumber, currency, amount, paymentDate, sourcePage: undefined, raw, warnings };
  });
}

function parsePdfText(textContent: string): CommissionDraftRow[] {
  return textContent.split(/\r?\n/).map((line, index) => {
    const values = line.split(/\s{2,}|\t|[,;|]/).map((value) => value.trim()).filter(Boolean);
    const policyNumber = values.find((value) => /[A-Z]\d{2,}|\d{6,}/i.test(value));
    const amountValue = values.map(money).find((value) => value !== undefined);
    const currency = values.find((value) => /^(MXN|USD|EUR)$/i.test(value));
    const warnings = policyNumber && amountValue !== undefined ? [] : ["Fila PDF requiere revisión manual."];
    return { rowKey: `page-text-${index + 1}`, policyNumber, currency: currency?.toUpperCase(), amount: amountValue, raw: { line }, warnings };
  }).filter((row) => row.policyNumber || row.amount !== undefined);
}

export async function createCommissionStatement(input: { fileName: string; mimeType: string; buffer: Buffer; periodStart?: Date; periodEnd?: Date }) {
  const context = await requireOrganizationContext();
  if (!(["OWNER", "ADMIN"] as string[]).includes(context.membershipRole)) throw new Error("COMMISSION_IMPORT_FORBIDDEN");
  const hash = createHash("sha256").update(input.buffer).digest("hex");
  let rows: CommissionDraftRow[] = [];
  let extractionError: string | null = null;
  try {
    rows = input.mimeType.includes("pdf")
      ? parsePdfText((await extractPdfTextFromBytes(input.buffer, { maxPages: 40, timeoutMs: 15_000 })).text)
      : parseCommissionStatement(input.buffer, input.mimeType);
  } catch (error) {
    extractionError = error instanceof Error ? error.message.slice(0, 300) : "No se pudo extraer el archivo.";
  }
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const existing = await tx.commissionStatement.findUnique({ where: { organizationId_sourceHash: { organizationId: context.organizationId, sourceHash: hash } }, select: { id: true } });
    if (existing) throw new Error("COMMISSION_STATEMENT_DUPLICATE");
    const statement = await tx.commissionStatement.create({ data: { organizationId: context.organizationId, sourceFileName: input.fileName, mimeType: input.mimeType, sourceHash: hash, periodStart: input.periodStart, periodEnd: input.periodEnd, status: extractionError ? "EXTRACTION_FAILED" : "REVIEW", summaryJson: JSON.stringify({ rows: rows.length, warnings: rows.filter((row) => row.warnings.length).length, extractionError }), createdById: context.userId } });
    for (const row of rows) {
      const matches = await tx.commission.findMany({ where: { organizationId: context.organizationId, ...(row.receiptNumber ? { receipt: { receiptNumber: row.receiptNumber } } : {}), ...(row.policyNumber ? { policy: { policyNumber: row.policyNumber } } : {}) }, select: { id: true, receipt: { select: { currency: true } } }, take: 3 });
      const compatible = row.currency ? matches.filter((match) => match.receipt?.currency === row.currency) : matches;
      const status = compatible.length === 1 && row.amount !== undefined && row.warnings.length === 0 ? "MATCHED" : compatible.length > 1 ? "AMBIGUOUS" : "REVIEW";
      await tx.commissionStatementRow.create({ data: { organizationId: context.organizationId, statementId: statement.id, sourceRowKey: row.rowKey, sourcePage: row.sourcePage, rawJson: JSON.stringify(row.raw), normalizedJson: JSON.stringify(row), policyNumber: row.policyNumber, receiptNumber: row.receiptNumber, currency: row.currency, amount: row.amount === undefined ? undefined : new Prisma.Decimal(row.amount), paymentDate: row.paymentDate ? new Date(row.paymentDate) : undefined, status, commissionId: status === "MATCHED" ? compatible[0].id : undefined, matchReason: status === "MATCHED" ? "Identidad y moneda únicas" : undefined, discrepancyReason: row.warnings.join(" ") || undefined } });
    }
    await writeActivityLog({ organizationId: context.organizationId, action: "CREATE_COMMISSION_STATEMENT", entityType: "CommissionStatement", entityId: statement.id, newValue: { sourceHash: hash, rows: rows.length, extractionError }, userId: context.userId, db: tx });
    return statement;
  });
}

export async function applyCommissionStatementRow(rowId: string, expectedVersion: number, reason?: string) {
  const context = await requireOrganizationContext();
  if (!(["OWNER", "ADMIN"] as string[]).includes(context.membershipRole)) throw new Error("COMMISSION_APPLY_FORBIDDEN");
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const row = await tx.commissionStatementRow.findFirst({ where: { id: rowId, organizationId: context.organizationId }, include: { commission: true, statement: true } });
    if (!row || row.version !== expectedVersion || row.status !== "MATCHED" || !row.commission || row.commission.version < 1) throw new Error("COMMISSION_ROW_CONFLICT");
    const updated = await tx.commission.updateMany({ where: { id: row.commission.id, organizationId: context.organizationId, version: row.commission.version }, data: { actualAmount: row.amount, paidDate: row.paymentDate ?? new Date(), status: "PAID", version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("COMMISSION_ROW_CONFLICT");
    await tx.commissionStatementRow.update({ where: { id: row.id }, data: { status: "APPLIED", version: { increment: 1 } } });
    await writeActivityLog({ organizationId: context.organizationId, action: "APPLY_COMMISSION_STATEMENT_ROW", entityType: "CommissionStatementRow", entityId: row.id, newValue: { commissionId: row.commission.id, reason: reason ?? null }, userId: context.userId, db: tx });
    return { ok: true, commissionId: row.commission.id };
  });
}

export async function correctCommissionApplication(input: {
  rowId: string;
  expectedRowVersion: number;
  expectedCommissionVersion: number;
  prior: { actualAmount: string | null; paidDate: string | null; status: string };
  reason: string;
  evidence?: Record<string, unknown>;
}) {
  const context = await requireOrganizationContext();
  if (!( ["OWNER", "ADMIN"] as string[]).includes(context.membershipRole)) throw new Error("COMMISSION_CORRECTION_FORBIDDEN");
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) throw new Error("COMMISSION_CORRECTION_REASON_REQUIRED");
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const row = await tx.commissionStatementRow.findFirst({ where: { id: input.rowId, organizationId: context.organizationId }, include: { commission: true } });
    if (!row || row.version !== input.expectedRowVersion || !row.commission) throw new Error("COMMISSION_CORRECTION_CONFLICT");
    const commission = row.commission;
    if (commission.version !== input.expectedCommissionVersion) throw new Error("COMMISSION_CORRECTION_CONFLICT");
    const resulting = { actualAmount: commission.actualAmount?.toString() ?? null, paidDate: commission.paidDate?.toISOString() ?? null, status: commission.status };
    if (resulting.actualAmount !== (row.amount?.toString() ?? null) || resulting.status !== "PAID") throw new Error("COMMISSION_CORRECTION_HISTORY_CONFLICT");
    const restored = await tx.commission.updateMany({ where: { id: commission.id, organizationId: context.organizationId, version: input.expectedCommissionVersion, actualAmount: commission.actualAmount, status: commission.status }, data: { actualAmount: input.prior.actualAmount, paidDate: input.prior.paidDate ? new Date(input.prior.paidDate) : null, status: input.prior.status as never, version: { increment: 1 } } });
    if (restored.count !== 1) throw new Error("COMMISSION_CORRECTION_CONFLICT");
    await tx.commissionCorrection.create({ data: { organizationId: context.organizationId, commissionId: commission.id, statementRowId: row.id, actorId: context.userId, reason, priorValuesJson: JSON.stringify(input.prior), currentValuesJson: JSON.stringify(resulting), evidenceJson: input.evidence ? JSON.stringify(input.evidence) : null } });
    await tx.commissionStatementRow.update({ where: { id: row.id }, data: { status: "REVIEW", version: { increment: 1 }, discrepancyReason: reason } });
    await writeActivityLog({ organizationId: context.organizationId, action: "CORRECT_COMMISSION_APPLICATION", entityType: "CommissionStatementRow", entityId: row.id, oldValue: resulting, newValue: { restored: input.prior, reason }, userId: context.userId, db: tx });
    return { ok: true, commissionId: commission.id };
  });
}
