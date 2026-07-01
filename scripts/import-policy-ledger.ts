import "dotenv/config";

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import * as XLSX from "@e965/xlsx";
import { Client as PgClient } from "pg";
import { businessStartOfDay, parseBusinessDateInput } from "../src/lib/business-dates.ts";
import { reconcileReceiptState } from "@/lib/receipt-reconciliation";

type Mode = "dry-run" | "apply";

type Args = {
  mode: Mode;
  csvPath: string;
  paidPath: string;
  exportReport: boolean;
};

type ExistingClient = {
  id: string;
  fullName: string;
  status: string;
};

type ExistingInsurer = {
  id: string;
  name: string;
  status: string;
};

type ExistingPolicy = {
  id: string;
  policyNumber: string;
  familyRootId: string | null;
  clientId: string;
  insurerId: string;
  policyType: string;
  status: string;
  startDate: Date;
  endDate: Date;
  premiumAmount: string;
  currency: string;
  paymentFrequency: string;
  paymentPlan: string | null;
  insuredObject: string | null;
};

type ExistingReceipt = {
  id: string;
  receiptNumber: string;
  policyId: string;
  clientId: string;
  insurerId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  dueDate: Date;
  amount: string;
  currency: string;
  status: string;
  paidDate: Date | null;
  paymentMethod: string | null;
};

type PolicyCsvRow = {
  rowNumber: number;
  policyNumber: string;
  policyKey: string;
  receiptNumber: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  endorsementNumber: string;
  endorsementType: string;
  endorsementConcept: string;
  rawClient: string;
  clientName: string;
  referidorName: string | null;
  description: string;
  model: string;
  serial: string;
  subramo: string;
  product: string;
  insurerName: string;
  policyStart: Date | null;
  policyEnd: Date | null;
  paymentFrequency: string;
  paidFlag: string;
  paidDate: Date | null;
  currency: string;
  netAmount: number;
  totalAmount: number;
  status: string;
};

type PaidReceiptRow = {
  rowNumber: number;
  policyNumber: string;
  policyKey: string;
  receiptNumber: string;
  insurerName: string;
  clientName: string;
  paidDate: Date | null;
  netPaid: number;
  totalPaid: number;
};

type ReportRow = Record<string, string | number | boolean | null | undefined>;

type ImportReport = {
  summary: ReportRow[];
  clients: ReportRow[];
  insurers: ReportRow[];
  policies: ReportRow[];
  receipts: ReportRow[];
  payments: ReportRow[];
  ambiguous: ReportRow[];
  skipped: ReportRow[];
  errors: ReportRow[];
};

const DEFAULT_CSV_PATH = "/Users/pedrogomez/Downloads/Polizas.csv";
const DEFAULT_PAID_PATH = "/Users/pedrogomez/Downloads/recibos pagados.xls";
const IMPORT_USER_EMAIL = "pedroagl93@gmail.com";
const DATA_DIR = path.join(process.cwd(), "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const EXPORTS_DIR = path.join(DATA_DIR, "exports");
const PAYMENT_METHOD = "Reporte externo";
const TODAY = parseBusinessDateInput("2026-05-27");

loadEnvLocal();

const INSURER_ALIASES = new Map<string, string>([
  [normalizeName("AXA SEGUROS, S.A. DE C.V."), "AXA Seguros"],
  [normalizeName("CHUBB SEGUROS MÉXICO, S.A."), "Chubb Seguros México"],
  [normalizeName("MAPFRE MÉXICO, S.A."), "Mapfre México"],
  [normalizeName("QUÁLITAS, COMPAÑÍA DE SEGUROS, S.A. DE C.V."), "Qualitas Compañía de Seguros"],
  [normalizeName("SEGUROS BANORTE, S.A. DE C.V., GRUPO FINANCIERO BANORTE"), "Banorte Seguros"],
  [normalizeName("ZURICH, COMPAÑÍA DE SEGUROS, S.A."), "Zurich Seguros"],
]);

function parseArgs(argv = process.argv.slice(2)): Args {
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    if (token.includes("=")) {
      const [key, ...rest] = token.slice(2).split("=");
      flags.set(key, rest.join("="));
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }

  const apply = flags.get("apply") === true || flags.get("mode") === "apply";
  const dryRun = flags.get("dry-run") === true || flags.get("dryRun") === true || flags.get("mode") === "dry-run";

  if (apply && dryRun) {
    throw new Error("Usa solo uno: --dry-run o --apply.");
  }

  return {
    mode: apply ? "apply" : "dry-run",
    csvPath: stringFlag(flags, "csv", DEFAULT_CSV_PATH),
    paidPath: stringFlag(flags, "paid", DEFAULT_PAID_PATH),
    exportReport: flags.has("export-report") || flags.has("exportReport"),
  };
}

function loadEnvLocal() {
  const localEnvPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(localEnvPath)) return;

  const content = readFileSync(localEnvPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const rawValue = rest.join("=").trim();
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function stringFlag(flags: Map<string, string | boolean>, name: string, fallback: string) {
  const value = flags.get(name);
  return typeof value === "string" && value.trim() ? value : fallback;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizePolicyNumber(value: string) {
  const compact = cleanText(value).replace(/\s+/g, "").toUpperCase();
  return compact.replace(/^0+(?=\d)/, "");
}

function dateKey(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return businessStartOfDay(value);
  }

  const text = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return parseBusinessDateInput(text);
  }

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return parseBusinessDateInput(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function parseMoney(value: unknown) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

function sameMoney(left: string | number, right: number) {
  return Math.round(Number(left) * 100) === Math.round(right * 100);
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined) {
  return dateKey(left) === dateKey(right);
}

function daysBetween(left: Date, right: Date) {
  return Math.round((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
}

function id() {
  return randomUUID();
}

function extractClient(raw: string) {
  const text = cleanText(raw);
  const marker = "ASEGURADO:";
  const markerIndex = text.toUpperCase().indexOf(marker);

  if (markerIndex === -1) {
    return { clientName: text, referidorName: text };
  }

  const before = cleanText(text.slice(0, markerIndex).replace(/-\s*$/g, ""));
  const after = cleanText(text.slice(markerIndex + marker.length));

  return {
    clientName: before || text,
    referidorName: after || before || text,
  };
}

function inferClientType(name: string) {
  return /\b(SA|S\.A\.|SAPI|S\.A\.P\.I|SC|S\.C\.|CV|C\.V\.|ABOGADOS|INDUSTRIAS|LOGISTICA|MOTORES)\b/i.test(name)
    ? "COMPANY"
    : "PERSON";
}

function personTokenKey(name: string) {
  const text = cleanText(name);
  if (inferClientType(text) === "COMPANY") return "";
  const tokens = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 1)
    .sort();

  return tokens.length >= 3 ? tokens.join("|") : "";
}

function mapPolicyType(subramo: string) {
  const value = normalizeName(subramo);
  if (value.includes("GMM") || value.includes("GASTOSMEDICOS")) return "GMM";
  if (value.includes("VIDA")) return "VIDA";
  if (value.includes("DANOS")) return "DANOS";
  if (value.includes("RESPONSABILIDADCIVIL")) return "RESPONSABILIDAD_CIVIL";
  if (value.includes("ACCIDENTES")) return "ACCIDENTES";
  if (value.includes("AUTO")) return "AUTO";
  return "OTRO";
}

function mapPaymentFrequency(value: string) {
  const normalized = normalizeName(value);
  if (normalized.includes("MENSUAL")) return "MONTHLY";
  if (normalized.includes("TRIMESTRAL")) return "QUARTERLY";
  if (normalized.includes("SEMESTRAL")) return "SEMIANNUAL";
  if (normalized.includes("CONTADO")) return "SINGLE";
  return "OTHER";
}

function mapCurrency(value: string) {
  const normalized = normalizeName(value);
  if (normalized.includes("DOLAR")) return "USD";
  return "MXN";
}

function mapReceiptStatus(value: string) {
  const normalized = normalizeName(value);
  if (normalized === "PAGADO") return "PAID";
  if (normalized === "CANCELADO") return "CANCELLED";
  return "PENDING";
}

function derivePolicyStatus(rows: PolicyCsvRow[]) {
  const statuses = rows.map((row) => normalizeName(row.status)).filter(Boolean);
  const latestEnd = latestDate(rows.map((row) => row.policyEnd));
  const allCancelled = statuses.length > 0 && statuses.every((status) => status === "CANCELADO");
  const anyPending = statuses.includes("PENDIENTE");

  if (allCancelled) return "CANCELLED";
  if (latestEnd && latestEnd < TODAY) return "EXPIRED";
  if (anyPending) return "ACTIVE";
  return "ACTIVE";
}

function earliestDate(dates: Array<Date | null>) {
  const validDates = dates.filter((date): date is Date => Boolean(date));
  return validDates.sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

function latestDate(dates: Array<Date | null>) {
  const validDates = dates.filter((date): date is Date => Boolean(date));
  return validDates.sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function canonicalInsurerName(sourceName: string) {
  return INSURER_ALIASES.get(normalizeName(sourceName)) ?? sourceName;
}

function receiptKey(policyId: string, receiptNumber: string, periodStart: Date, periodEnd: Date) {
  return [policyId, receiptNumber, dateKey(periodStart), dateKey(periodEnd)].join("|");
}

function paidKey(policyKey: string, receiptNumber: string) {
  return [policyKey, receiptNumber].join("|");
}

function policyGroupKey(policyNumber: string, startDate: Date | null, endDate: Date | null) {
  return [normalizePolicyNumber(policyNumber), dateKey(startDate), dateKey(endDate)].join("|");
}

function policyGroupKeyFromRow(row: PolicyCsvRow) {
  return policyGroupKey(row.policyNumber, row.policyStart ?? row.periodStart, row.policyEnd ?? row.periodEnd);
}

function policyGroupKeyFromPolicy(policy: ExistingPolicy) {
  return policyGroupKey(policy.policyNumber, policy.startDate, policy.endDate);
}

function resolvePolicyFamilyRootId(
  policies: ExistingPolicy[],
  policyNumber: string,
  clientId: string,
  insurerId: string,
) {
  const target = normalizePolicyNumber(policyNumber);
  const matches = policies
    .filter((policy) => normalizePolicyNumber(policy.policyNumber) === target)
    .filter((policy) => policy.clientId === clientId && policy.insurerId === insurerId)
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

  const root = matches[0];
  return root ? root.familyRootId ?? root.id : null;
}

function readPolicyRows(csvPath: string): PolicyCsvRow[] {
  const workbook = XLSX.readFile(csvPath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  return rows.map((row, index) => {
    const rawClient = cleanText(row["Cliente"]);
    const { clientName, referidorName } = extractClient(rawClient);
    const policyNumber = cleanText(row["No. de Póliza"]);

    return {
      rowNumber: index + 2,
      policyNumber,
      policyKey: normalizePolicyNumber(policyNumber),
      receiptNumber: cleanText(row["No. Recibo"]),
      periodStart: parseDate(row["Ini Vigencia Rec"]),
      periodEnd: parseDate(row["Fin Vigencia Rec"]),
      endorsementNumber: cleanText(row["No. de Endoso"]),
      endorsementType: cleanText(row["Tipo Endoso"]),
      endorsementConcept: cleanText(row["Concepto Endoso"]),
      rawClient,
      clientName,
      referidorName,
      description: cleanText(row["Descripción"]),
      model: cleanText(row["Modelo"]),
      serial: cleanText(row["Serie"]),
      subramo: cleanText(row["Subramo"]),
      product: cleanText(row["Producto"]),
      insurerName: cleanText(row["Compañía"]),
      policyStart: parseDate(row["Inicio Vigencia Póliza"]),
      policyEnd: parseDate(row["Fin Vigencia"]),
      paymentFrequency: cleanText(row["Frecuencia Pago"]),
      paidFlag: cleanText(row["Pagado"]),
      paidDate: parseDate(row["Fecha aplicación"]),
      currency: cleanText(row["Moneda"]),
      netAmount: parseMoney(row["Prima Neta Recibo"]),
      totalAmount: parseMoney(row["Prima Total Recibo"]),
      status: cleanText(row["Estatus"]),
    };
  });
}

function readPaidReceiptRows(paidPath: string): PaidReceiptRow[] {
  const workbook = XLSX.readFile(paidPath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  const parsed: PaidReceiptRow[] = [];
  for (const [index, row] of rows.entries()) {
    const policyNumber = cleanText(row[0]);
    const receiptNumber = cleanText(row[3]);
    const insurerName = cleanText(row[4]);
    const clientName = cleanText(row[6]);

    if (!/^\d/.test(policyNumber) || !receiptNumber || !insurerName || !clientName) continue;

    parsed.push({
      rowNumber: index + 1,
      policyNumber,
      policyKey: normalizePolicyNumber(policyNumber),
      receiptNumber,
      insurerName,
      clientName,
      paidDate: parseDate(row[11]),
      netPaid: parseMoney(row[13]),
      totalPaid: parseMoney(row[14]),
    });
  }

  return parsed;
}

async function getConnectionString() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString || !/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error("DATABASE_URL debe apuntar a Postgres para este import.");
  }

  return connectionString;
}

async function connectDb() {
  const connectionString = await getConnectionString();
  const db = new PgClient({ connectionString, ssl: { rejectUnauthorized: false } });
  await db.connect();
  return db;
}

async function loadState(db: PgClient) {
  const clients = await db.query<ExistingClient>('select id, "fullName", "referidorId", status from public."Client"');
  const insurers = await db.query<ExistingInsurer>('select id, name, status from public."Insurer"');
  const policies = await db.query<ExistingPolicy>(
    'select id, "policyNumber", "familyRootId", "clientId", "insurerId", "policyType", status, "startDate", "endDate", "premiumAmount", currency, "paymentFrequency", "paymentPlan", "insuredObject" from public."Policy"',
  );
  const receipts = await db.query<ExistingReceipt>(
    'select id, "receiptNumber", "policyId", "clientId", "insurerId", "periodStartDate", "periodEndDate", "dueDate", amount, currency, status, "paidDate", "paymentMethod" from public."Receipt"',
  );
  const payments = await db.query<{ receiptId: string; sourceEvidenceKey: string | null }>('select "receiptId", "sourceEvidenceKey" from public."Payment"');
  const users = await db.query<{ id: string; email: string }>('select id, email from public."User"');

  const importUser = users.rows.find((user) => user.email.toLowerCase() === IMPORT_USER_EMAIL)?.id;
  if (!importUser) {
    throw new Error(`No existe el usuario de importación ${IMPORT_USER_EMAIL}.`);
  }

  return {
    clients: clients.rows,
    insurers: insurers.rows,
    policies: policies.rows,
    receipts: receipts.rows,
    paymentReceiptIds: new Set(payments.rows.map((payment) => payment.receiptId)),
    paymentSourceEvidenceKeys: new Set(payments.rows.map((payment) => payment.sourceEvidenceKey).filter((key): key is string => Boolean(key))),
    importUser,
  };
}

function buildMultiMap<T>(rows: T[], keyFn: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

function initReport(): ImportReport {
  return {
    summary: [],
    clients: [],
    insurers: [],
    policies: [],
    receipts: [],
    payments: [],
    ambiguous: [],
    skipped: [],
    errors: [],
  };
}

function pushSummary(report: ImportReport, metric: string, value: string | number) {
  report.summary.push({ Metrica: metric, Valor: value });
}

async function backupPostgres() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const connectionString = await getConnectionString();
  const url = new URL(connectionString);
  const backupPath = path.join(BACKUPS_DIR, `postgres-policy-ledger-${timestampForFile()}.dump`);
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "require",
  };

  const result = spawnSync(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-acl", "--file", backupPath],
    { env, encoding: "utf8" },
  );

  if (result.status !== 0) {
    return backupLogicalJson(result.stderr || result.stdout || "pg_dump falló sin detalle");
  }

  return backupPath;
}

async function backupLogicalJson(reason: string) {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  const backupPath = path.join(BACKUPS_DIR, `postgres-policy-ledger-${timestampForFile()}.json`);
  const db = await connectDb();

  try {
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    );
    const snapshot: {
      createdAt: string;
      backupType: string;
      fallbackReason: string;
      tables: Record<string, unknown[]>;
    } = {
      createdAt: new Date().toISOString(),
      backupType: "logical-json",
      fallbackReason: reason.slice(0, 1000),
      tables: {},
    };

    for (const table of tables.rows) {
      const tableName = table.table_name;
      const result = await db.query(`select * from public."${tableName}"`);
      snapshot.tables[tableName] = result.rows;
    }

    await fs.writeFile(backupPath, JSON.stringify(snapshot, null, 2), "utf8");
    return backupPath;
  } finally {
    await db.end();
  }
}

function timestampForFile(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("-");
}

function buildInsuredObject(row: PolicyCsvRow) {
  const details = [row.description, row.model && row.model !== "0" ? `Modelo ${row.model}` : "", row.serial ? `Serie ${row.serial}` : ""]
    .filter(Boolean)
    .join(" · ");
  return details || null;
}

async function ensureClient(params: {
  db: PgClient;
  apply: boolean;
  name: string;
  clients: ExistingClient[];
  clientByName: Map<string, ExistingClient[]>;
  clientByPersonTokens: Map<string, ExistingClient[]>;
  report: ImportReport;
  importUser: string;
  source: string;
}) {
  const name = cleanText(params.name);
  const normalized = normalizeName(name);
  if (!name || !normalized) {
    params.report.errors.push({ Entidad: "Cliente", Fuente: params.source, Error: "Cliente vacío" });
    return null;
  }

  const exactMatches = params.clientByName.get(normalized) ?? [];
  if (exactMatches.length > 1) {
    params.report.ambiguous.push({
      Entidad: "Cliente",
      Llave: name,
      Motivo: "Nombre normalizado duplicado en DB",
      Coincidencias: exactMatches.map((match) => match.fullName).join(" | "),
    });
    return null;
  }

  let match = exactMatches[0] ?? null;
  const tokenKey = personTokenKey(name);
  if (!match && tokenKey) {
    const tokenMatches = params.clientByPersonTokens.get(tokenKey) ?? [];
    if (tokenMatches.length === 1) {
      match = tokenMatches[0];
    }
  }

  if (match) {
    params.report.clients.push({ Accion: "SIN_CAMBIOS", Cliente: match.fullName, Fuente: params.source });
    return match;
  }

  const newClient: ExistingClient = {
    id: id(),
    fullName: name,
    status: "ACTIVE",
  };
  params.report.clients.push({
    Accion: params.apply ? "CREAR" : "CREARIA",
    Cliente: name,
    Tipo: inferClientType(name),
    Fuente: params.source,
  });

  if (params.apply) {
    await params.db.query(
      'insert into public."Client" (id, "fullName", type, status, "portfolioOwnerId", "createdAt", "updatedAt", "createdById", "updatedById") values ($1,$2,$3,$4,$5,now(),now(),$5,$5)',
      [newClient.id, newClient.fullName, inferClientType(name), "ACTIVE", params.importUser],
    );
  }

  params.clients.push(newClient);
  addToMultiMap(params.clientByName, normalized, newClient);
  if (tokenKey) addToMultiMap(params.clientByPersonTokens, tokenKey, newClient);
  return newClient;
}

async function ensureInsurer(params: {
  db: PgClient;
  apply: boolean;
  sourceName: string;
  insurers: ExistingInsurer[];
  insurerByName: Map<string, ExistingInsurer[]>;
  report: ImportReport;
}) {
  const canonicalName = canonicalInsurerName(cleanText(params.sourceName));
  const normalized = normalizeName(canonicalName);
  const matches = params.insurerByName.get(normalized) ?? [];

  if (matches.length > 1) {
    params.report.ambiguous.push({
      Entidad: "Aseguradora",
      Llave: canonicalName,
      Motivo: "Nombre normalizado duplicado en DB",
      Coincidencias: matches.map((match) => match.name).join(" | "),
    });
    return null;
  }

  if (matches[0]) {
    params.report.insurers.push({
      Accion: "SIN_CAMBIOS",
      Fuente: params.sourceName,
      Aseguradora: matches[0].name,
    });
    return matches[0];
  }

  const insurer: ExistingInsurer = { id: id(), name: canonicalName, status: "ACTIVE" };
  params.report.insurers.push({
    Accion: params.apply ? "CREAR" : "CREARIA",
    Fuente: params.sourceName,
    Aseguradora: canonicalName,
  });

  if (params.apply) {
    await params.db.query('insert into public."Insurer" (id, name, status, "createdAt", "updatedAt") values ($1,$2,$3,now(),now())', [
      insurer.id,
      insurer.name,
      insurer.status,
    ]);
  }

  params.insurers.push(insurer);
  addToMultiMap(params.insurerByName, normalized, insurer);
  return insurer;
}

function addToMultiMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const current = map.get(key) ?? [];
  current.push(value);
  map.set(key, current);
}

function sourceEvidenceKeyForPaidRow(row: PaidReceiptRow) {
  return [
    row.policyKey,
    cleanText(row.receiptNumber),
    dateKey(row.paidDate),
    Math.round(row.totalPaid * 100),
    normalizeName(row.clientName),
    normalizeName(row.insurerName),
  ].join("|");
}

function choosePaidEvidence(
  receipt: {
    receiptNumber: string;
    amount: unknown;
    dueDate: Date;
    periodStartDate: Date;
    periodEndDate: Date;
    policyNumber: string;
    clientName: string;
    insurerName: string;
  },
  candidates: PaidReceiptRow[],
  usedEvidence: Set<string>,
) {
  const ranked = candidates
    .filter((candidate) => !usedEvidence.has(sourceEvidenceKeyForPaidRow(candidate)))
    .map((candidate) => {
      const amountDiff = Math.abs(Number(receipt.amount) - candidate.totalPaid);
      const dueDiff = candidate.paidDate ? Math.abs(candidate.paidDate.getTime() - receipt.dueDate.getTime()) / (1000 * 60 * 60 * 24) : 999;
      const termDiff =
        candidate.paidDate && receipt.periodStartDate && receipt.periodEndDate
          ? Math.min(
              Math.abs(candidate.paidDate.getTime() - receipt.periodStartDate.getTime()) / (1000 * 60 * 60 * 24),
              Math.abs(candidate.paidDate.getTime() - receipt.periodEndDate.getTime()) / (1000 * 60 * 60 * 24),
            )
          : 999;

      let score = 0;
      if (amountDiff <= 0.01) score += 40;
      else if (amountDiff <= 5) score += 25;
      else if (amountDiff <= 25) score += 10;
      if (dueDiff <= 30) score += 25;
      else if (dueDiff <= 60) score += 10;
      if (termDiff <= 30) score += 25;
      else if (termDiff <= 60) score += 10;
      if (normalizeName(candidate.clientName) === normalizeName(receipt.clientName)) score += 10;
      if (normalizeName(candidate.insurerName) === normalizeName(receipt.insurerName)) score += 10;

      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score || left.candidate.rowNumber - right.candidate.rowNumber);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 60 || (second && second.score === best.score)) {
    return { candidate: null as PaidReceiptRow | null, ambiguous: ranked.length > 1, score: best?.score ?? 0 };
  }

  return { candidate: best.candidate, ambiguous: false, score: best.score };
}

async function syncPolicyInsuredRecords(params: {
  db: PgClient;
  apply: boolean;
  policyId: string;
  insuredName: string;
  assetDescription: string | null;
  assetSerial: string | null;
  policyType: string;
  source: string;
}) {
  if (!params.apply) return;

  await params.db.query('delete from public."PolicyInsuredParty" where "policyId" = $1', [params.policyId]);
  await params.db.query('delete from public."PolicyInsuredAsset" where "policyId" = $1', [params.policyId]);

  await params.db.query(
    'insert into public."PolicyInsuredParty" (id, "policyId", "fullName", "isPrimary", "sourceLabel", "createdAt", "updatedAt") values ($1,$2,$3,$4,$5,now(),now())',
    [id(), params.policyId, params.insuredName, true, params.source],
  );

  if (params.assetDescription || params.assetSerial) {
    await params.db.query(
      'insert into public."PolicyInsuredAsset" (id, "policyId", "assetType", "description", "serialNumber", "isPrimary", "createdAt", "updatedAt") values ($1,$2,$3,$4,$5,$6,now(),now())',
      [id(), params.policyId, params.policyType, params.assetDescription ?? params.insuredName, params.assetSerial, true],
    );
  }
}

async function runImport(args: Args) {
  const policyRows = readPolicyRows(args.csvPath).filter((row) => row.policyKey && row.policyNumber);
  const paidRows = readPaidReceiptRows(args.paidPath);
  const paidByReceipt = new Map<string, PaidReceiptRow[]>();

  for (const paid of paidRows) {
    const key = paidKey(paid.policyKey, paid.receiptNumber);
    const existing = paidByReceipt.get(key) ?? [];
    existing.push(paid);
    paidByReceipt.set(key, existing);
  }

  const db = await connectDb();
  const report = initReport();
  let backupPath = "";

  try {
    const state = await loadState(db);
    const clientByName = buildMultiMap(state.clients, (client) => normalizeName(client.fullName));
    const clientByPersonTokens = buildMultiMap(state.clients, (client) => personTokenKey(client.fullName));
    const insurerByName = buildMultiMap(state.insurers, (insurer) => normalizeName(insurer.name));
    const policyByKey = buildMultiMap(state.policies, policyGroupKeyFromPolicy);
    const receiptByExactKey = buildMultiMap(state.receipts, (receipt) =>
      receiptKey(receipt.policyId, receipt.receiptNumber, receipt.periodStartDate, receipt.periodEndDate),
    );
    const usedEvidenceKeys = new Set(state.paymentSourceEvidenceKeys ?? []);

    const policyGroups = new Map<string, PolicyCsvRow[]>();
    for (const row of policyRows) {
      const current = policyGroups.get(policyGroupKeyFromRow(row)) ?? [];
      current.push(row);
      policyGroups.set(policyGroupKeyFromRow(row), current);
    }

    pushSummary(report, "Modo", args.mode);
    pushSummary(report, "CSV filas útiles", policyRows.length);
    pushSummary(report, "CSV pólizas únicas", policyGroups.size);
    pushSummary(report, "XLS pagos filas útiles", paidRows.length);
    pushSummary(report, "DB clientes antes", state.clients.length);
    pushSummary(report, "DB aseguradoras antes", state.insurers.length);
    pushSummary(report, "DB pólizas antes", state.policies.length);
    pushSummary(report, "DB recibos antes", state.receipts.length);
    pushSummary(report, "DB pagos antes", state.paymentReceiptIds.size);

    if (args.mode === "apply") {
      backupPath = await backupPostgres();
      pushSummary(report, "Backup previo", backupPath);
      await db.query("begin");
    }

    const policyIdByKey = new Map<string, string>();
    const skippedPolicyKeys = new Set<string>();

    for (const [policyKey, rows] of policyGroups) {
      let existingPolicies = policyByKey.get(policyKey) ?? [];
      if (existingPolicies.length > 1) {
        const duplicateResolution = await resolveDuplicatePoliciesForImport({
          db,
          apply: args.mode === "apply",
          sourcePolicyNumber: rows[0].policyNumber,
          policies: existingPolicies,
          receipts: state.receipts,
          report,
          importUser: state.importUser,
        });

        if (!duplicateResolution) {
          skippedPolicyKeys.add(policyKey);
          continue;
        }

        const duplicateIdSet = new Set(duplicateResolution.duplicateIds);
        state.policies = state.policies.filter((policy) => !duplicateIdSet.has(policy.id));
        state.receipts = state.receipts.filter((receipt) => !duplicateIdSet.has(receipt.policyId));
        existingPolicies = [duplicateResolution.canonical];
        policyByKey.set(policyKey, existingPolicies);
      }

      const first = rows[0];
      const client = await ensureClient({
        db,
        apply: args.mode === "apply",
        name: first.clientName,
        clients: state.clients,
        clientByName,
        clientByPersonTokens,
        report,
        importUser: state.importUser,
        source: `Póliza ${first.policyNumber}`,
      });
      const insurer = await ensureInsurer({
        db,
        apply: args.mode === "apply",
        sourceName: first.insurerName,
        insurers: state.insurers,
        insurerByName,
        report,
      });

      if (!client || !insurer) {
        skippedPolicyKeys.add(policyKey);
        report.skipped.push({
          Entidad: "Póliza",
          Llave: first.policyNumber,
          Motivo: "Cliente o aseguradora ambiguos",
        });
        continue;
      }

      const startDate = earliestDate(rows.map((row) => row.policyStart)) ?? earliestDate(rows.map((row) => row.periodStart));
      const endDate = latestDate(rows.map((row) => row.policyEnd)) ?? latestDate(rows.map((row) => row.periodEnd));
      if (!startDate || !endDate) {
        skippedPolicyKeys.add(policyKey);
        report.errors.push({ Entidad: "Póliza", Llave: first.policyNumber, Error: "No tiene vigencia válida" });
        continue;
      }

      if (daysBetween(endDate, startDate) > 366) {
        skippedPolicyKeys.add(policyKey);
        report.errors.push({
          Entidad: "Póliza",
          Llave: first.policyNumber,
          Error: "Vigencia mayor a 366 días. Debe dividirse por anualidades aprobadas por ADMIN.",
        });
        continue;
      }

      const activeReceiptRows = rows.filter((row) => mapReceiptStatus(row.status) !== "CANCELLED" && row.totalAmount > 0);
      const premiumRows = activeReceiptRows.length ? activeReceiptRows : rows.filter((row) => row.totalAmount > 0);
      const premiumAmount = premiumRows.reduce((total, row) => total + row.totalAmount, 0);
      const policyData = {
        policyNumber: existingPolicies[0]?.policyNumber ?? first.policyNumber,
        familyRootId: existingPolicies[0]?.familyRootId ?? resolvePolicyFamilyRootId(state.policies, first.policyNumber, client.id, insurer.id),
        clientId: client.id,
        insurerId: insurer.id,
        policyType: mapPolicyType(first.subramo),
        status: derivePolicyStatus(rows),
        startDate,
        endDate,
        premiumAmount,
        currency: mapCurrency(first.currency),
        paymentFrequency: mapPaymentFrequency(first.paymentFrequency),
        paymentPlan: first.product || null,
        insuredObject: buildInsuredObject(first),
      };

      const existing = existingPolicies[0] ?? null;
      if (!existing) {
        const newPolicy: ExistingPolicy = {
          id: id(),
          ...policyData,
          premiumAmount: String(policyData.premiumAmount),
        };
        report.policies.push({
          Accion: args.mode === "apply" ? "CREAR" : "CREARIA",
          Poliza: first.policyNumber,
          Cliente: client.fullName,
          Aseguradora: insurer.name,
          Estatus: policyData.status,
          Inicio: dateKey(startDate),
          Fin: dateKey(endDate),
          Prima: policyData.premiumAmount,
        });

        if (args.mode === "apply") {
          await db.query(
          'insert into public."Policy" (id, "policyNumber", "clientId", "insurerId", "policyType", status, "startDate", "endDate", "premiumAmount", currency, "paymentFrequency", "paymentPlan", "insuredObject", "createdAt", "updatedAt", "createdById", "updatedById") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),$14,$14)',
            [
              newPolicy.id,
              newPolicy.policyNumber,
              newPolicy.clientId,
              newPolicy.insurerId,
              newPolicy.policyType,
              newPolicy.status,
              newPolicy.startDate,
              newPolicy.endDate,
              policyData.premiumAmount,
              newPolicy.currency,
              newPolicy.paymentFrequency,
              newPolicy.paymentPlan,
              newPolicy.insuredObject,
              state.importUser,
            ],
          );
        }
        state.policies.push(newPolicy);
        addToMultiMap(policyByKey, policyKey, newPolicy);
        policyIdByKey.set(policyKey, newPolicy.id);
        await syncPolicyInsuredRecords({
          db,
          apply: args.mode === "apply",
          policyId: newPolicy.id,
          insuredName: first.referidorName ?? first.clientName,
          assetDescription: policyData.insuredObject,
          assetSerial: first.serial || null,
          policyType: policyData.policyType,
          source: `Póliza ${first.policyNumber}`,
        });
        continue;
      }

      policyIdByKey.set(policyKey, existing.id);
      const changes: string[] = [];
      if (existing.clientId !== policyData.clientId) changes.push("clientId");
      if (existing.insurerId !== policyData.insurerId) changes.push("insurerId");
      if (existing.policyType !== policyData.policyType) changes.push("policyType");
      if (existing.status !== policyData.status) changes.push("status");
      if (!sameDate(existing.startDate, policyData.startDate)) changes.push("startDate");
      if (!sameDate(existing.endDate, policyData.endDate)) changes.push("endDate");
      if (!sameMoney(existing.premiumAmount, policyData.premiumAmount)) changes.push("premiumAmount");
      if (existing.currency !== policyData.currency) changes.push("currency");
      if (existing.paymentFrequency !== policyData.paymentFrequency) changes.push("paymentFrequency");
      if ((existing.paymentPlan ?? "") !== (policyData.paymentPlan ?? "")) changes.push("paymentPlan");
      if ((existing.insuredObject ?? "") !== (policyData.insuredObject ?? "")) changes.push("insuredObject");

      if (!changes.length) {
        report.policies.push({ Accion: "SIN_CAMBIOS", Poliza: existing.policyNumber, Cliente: client.fullName });
        continue;
      }

      report.policies.push({
        Accion: args.mode === "apply" ? "ACTUALIZAR" : "ACTUALIZARIA",
        Poliza: existing.policyNumber,
        Cliente: client.fullName,
        Campos: changes.join(", "),
        Estatus: `${existing.status} -> ${policyData.status}`,
        Prima: policyData.premiumAmount,
      });

      if (args.mode === "apply") {
        await db.query(
          'update public."Policy" set "clientId"=$1, "insurerId"=$2, "policyType"=$3, status=$4, "startDate"=$5, "endDate"=$6, "premiumAmount"=$7, currency=$8, "paymentFrequency"=$9, "paymentPlan"=$10, "insuredObject"=$11, "updatedAt"=now(), "updatedById"=$12 where id=$13',
          [
            policyData.clientId,
            policyData.insurerId,
            policyData.policyType,
            policyData.status,
            policyData.startDate,
            policyData.endDate,
            policyData.premiumAmount,
            policyData.currency,
            policyData.paymentFrequency,
            policyData.paymentPlan,
            policyData.insuredObject,
            state.importUser,
            existing.id,
          ],
        );
      }

      Object.assign(existing, { ...policyData, premiumAmount: String(policyData.premiumAmount) });
      await syncPolicyInsuredRecords({
        db,
        apply: args.mode === "apply",
        policyId: existing.id,
        insuredName: first.referidorName ?? first.clientName,
        assetDescription: policyData.insuredObject,
        assetSerial: first.serial || null,
        policyType: policyData.policyType,
        source: `Póliza ${first.policyNumber}`,
      });
    }

    for (const row of policyRows) {
      if (skippedPolicyKeys.has(policyGroupKeyFromRow(row))) continue;
      if (!row.receiptNumber || !row.periodStart || !row.periodEnd) {
        report.skipped.push({
          Entidad: "Recibo",
          Fila: row.rowNumber,
          Poliza: row.policyNumber,
          Motivo: "Sin recibo o vigencia de recibo",
        });
        continue;
      }

      const policyId = policyIdByKey.get(policyGroupKeyFromRow(row));
      const policy = policyId ? state.policies.find((item) => item.id === policyId) : null;
      if (!policy) continue;

      const exactKey = receiptKey(policy.id, row.receiptNumber, row.periodStart, row.periodEnd);
      const existingMatches = receiptByExactKey.get(exactKey) ?? [];
      if (existingMatches.length > 1) {
        report.ambiguous.push({
          Entidad: "Recibo",
          Llave: `${policy.policyNumber} / ${row.receiptNumber}`,
          Motivo: "Recibo exacto duplicado en DB",
        });
        continue;
      }

      const existing = existingMatches[0] ?? null;
      let amount = row.totalAmount > 0 ? row.totalAmount : Number(existing?.amount ?? 0);
      const evidenceCandidates = paidByReceipt.get(paidKey(row.policyKey, row.receiptNumber)) ?? [];
      const receiptClient = state.clients.find((item) => item.id === policy.clientId);
      const receiptInsurer = state.insurers.find((item) => item.id === policy.insurerId);
      const evidenceSelection = choosePaidEvidence(
        {
          receiptNumber: row.receiptNumber,
          amount,
          dueDate: row.periodStart,
          periodStartDate: row.periodStart,
          periodEndDate: row.periodEnd,
          policyNumber: policy.policyNumber,
          clientName: receiptClient?.fullName ?? "",
          insurerName: receiptInsurer?.name ?? "",
        },
        evidenceCandidates,
        usedEvidenceKeys,
      );
      const paidEvidence = evidenceSelection.candidate;
      if (paidEvidence) {
        amount = paidEvidence.totalPaid > 0 ? paidEvidence.totalPaid : amount;
      }

      const receiptReconciliation = reconcileReceiptState({
        amount,
        status: mapReceiptStatus(row.status) as "PENDING" | "PAID" | "OVERDUE" | "CANCELLED",
        dueDate: row.periodStart,
        paidDate: paidEvidence?.paidDate ?? null,
        paymentMethod: paidEvidence ? PAYMENT_METHOD : null,
        payments: paidEvidence
          ? [
              {
                amount,
                paidDate: paidEvidence.paidDate ?? row.periodStart,
                paymentMethod: PAYMENT_METHOD,
              },
            ]
          : [],
        now: TODAY,
        closeTolerance: 5,
      });
      const receiptStatus = receiptReconciliation.nextStatus;
      const paidDate = receiptReconciliation.nextPaidDate;
      const paymentMethod = receiptReconciliation.nextPaymentMethod;

      if (!amount || amount < 0) {
        report.skipped.push({
          Entidad: "Recibo",
          Poliza: policy.policyNumber,
          Recibo: row.receiptNumber,
          Motivo: "Importe no positivo",
          Importe: amount,
        });
        continue;
      }

      if (!existing) {
        const newReceipt: ExistingReceipt = {
          id: id(),
          receiptNumber: row.receiptNumber,
          policyId: policy.id,
          clientId: policy.clientId,
          insurerId: policy.insurerId,
          periodStartDate: row.periodStart,
          periodEndDate: row.periodEnd,
          dueDate: row.periodStart,
          amount: String(amount),
          currency: mapCurrency(row.currency),
          status: receiptStatus,
          paidDate,
          paymentMethod,
        };

        report.receipts.push({
          Accion: args.mode === "apply" ? "CREAR" : "CREARIA",
          Poliza: policy.policyNumber,
          Recibo: row.receiptNumber,
          Estatus: receiptStatus,
          Inicio: dateKey(row.periodStart),
          Fin: dateKey(row.periodEnd),
          Importe: amount,
        });

        if (args.mode === "apply") {
          await db.query(
          'insert into public."Receipt" (id, "receiptNumber", "policyId", "clientId", "insurerId", "periodStartDate", "periodEndDate", "dueDate", amount, currency, status, "paidDate", "paymentMethod", "createdAt", "updatedAt", "createdById", "updatedById") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),$14,$14)',
            [
              newReceipt.id,
              newReceipt.receiptNumber,
              newReceipt.policyId,
              newReceipt.clientId,
              newReceipt.insurerId,
              newReceipt.periodStartDate,
              newReceipt.periodEndDate,
              newReceipt.dueDate,
              amount,
              newReceipt.currency,
              newReceipt.status,
              newReceipt.paidDate,
            newReceipt.paymentMethod,
            state.importUser,
            ],
          );
        }

        state.receipts.push(newReceipt);
        addToMultiMap(receiptByExactKey, exactKey, newReceipt);

        if (paidEvidence) {
          const evidenceKey = sourceEvidenceKeyForPaidRow(paidEvidence);
          usedEvidenceKeys.add(evidenceKey);
          if (!state.paymentSourceEvidenceKeys.has(evidenceKey)) {
            report.payments.push({
              Accion: args.mode === "apply" ? "CREAR" : "CREARIA",
              Poliza: policy.policyNumber,
              Recibo: row.receiptNumber,
              FechaPago: dateKey(paidEvidence.paidDate ?? row.periodStart),
              Importe: amount,
              Fuente: "recibos pagados.xls",
            });

            if (args.mode === "apply") {
              const paymentId = id();
              await db.query(
                'insert into public."Payment" (id, "receiptId", "policyId", "clientId", amount, currency, "paidDate", "paymentMethod", reference, notes, "sourceEvidenceKey", "createdAt", "updatedAt", "createdById", "updatedById") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),$12,$12)',
                [
                  paymentId,
                  newReceipt.id,
                  policy.id,
                  policy.clientId,
                  amount,
                  mapCurrency(row.currency),
                  paidDate ?? paidEvidence.paidDate ?? row.periodStart,
                  paymentMethod ?? PAYMENT_METHOD,
                  `import-${dateKey(paidEvidence.paidDate ?? row.periodStart)}-${row.receiptNumber}`,
                  "Pago importado desde reporte de recibos pagados.",
                  evidenceKey,
                  state.importUser,
                ],
              );
              state.paymentSourceEvidenceKeys.add(evidenceKey);
            }
          }
        }
        continue;
      }

      const changes: string[] = [];
      if (existing.clientId !== policy.clientId) changes.push("clientId");
      if (existing.insurerId !== policy.insurerId) changes.push("insurerId");
      if (!sameDate(existing.dueDate, row.periodStart)) changes.push("dueDate");
      if (!sameMoney(existing.amount, amount)) changes.push("amount");
      if (existing.currency !== mapCurrency(row.currency)) changes.push("currency");
      if (existing.status !== receiptStatus) changes.push("status");
      if (!sameDate(existing.paidDate, paidDate)) changes.push("paidDate");
      if ((existing.paymentMethod ?? "") !== (receiptStatus === "PAID" ? PAYMENT_METHOD : "")) changes.push("paymentMethod");

      if (!changes.length) {
        report.receipts.push({ Accion: "SIN_CAMBIOS", Poliza: policy.policyNumber, Recibo: row.receiptNumber });
      } else {
        report.receipts.push({
          Accion: args.mode === "apply" ? "ACTUALIZAR" : "ACTUALIZARIA",
          Poliza: policy.policyNumber,
          Recibo: row.receiptNumber,
          Campos: changes.join(", "),
          Estatus: `${existing.status} -> ${receiptStatus}`,
          Importe: amount,
        });

        if (args.mode === "apply") {
          await db.query(
          'update public."Receipt" set "clientId"=$1, "insurerId"=$2, "dueDate"=$3, amount=$4, currency=$5, status=$6, "paidDate"=$7, "paymentMethod"=$8, "updatedAt"=now(), "updatedById"=$9 where id=$10',
            [
              policy.clientId,
              policy.insurerId,
              row.periodStart,
              amount,
              mapCurrency(row.currency),
              receiptStatus,
              paidDate,
              receiptStatus === "PAID" ? PAYMENT_METHOD : null,
              state.importUser,
              existing.id,
            ],
          );
        }
      }

      Object.assign(existing, {
        clientId: policy.clientId,
        insurerId: policy.insurerId,
        dueDate: row.periodStart,
        amount: String(amount),
        currency: mapCurrency(row.currency),
        status: receiptStatus,
        paidDate,
        paymentMethod,
      });
      if (paidEvidence) {
        const evidenceKey = sourceEvidenceKeyForPaidRow(paidEvidence);
        usedEvidenceKeys.add(evidenceKey);
        if (!state.paymentSourceEvidenceKeys.has(evidenceKey)) {
          report.payments.push({
            Accion: args.mode === "apply" ? "CREAR" : "CREARIA",
            Poliza: policy.policyNumber,
            Recibo: row.receiptNumber,
            FechaPago: dateKey(paidEvidence.paidDate ?? row.periodStart),
            Importe: amount,
            Fuente: "recibos pagados.xls",
          });

          if (args.mode === "apply") {
            const paymentId = id();
            await db.query(
              'insert into public."Payment" (id, "receiptId", "policyId", "clientId", amount, currency, "paidDate", "paymentMethod", reference, notes, "sourceEvidenceKey", "createdAt", "updatedAt", "createdById", "updatedById") values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),$12,$12)',
              [
                paymentId,
                existing.id,
                policy.id,
                policy.clientId,
                amount,
                mapCurrency(row.currency),
                paidDate ?? paidEvidence.paidDate ?? row.periodStart,
                paymentMethod ?? PAYMENT_METHOD,
                `import-${dateKey(paidEvidence.paidDate ?? row.periodStart)}-${row.receiptNumber}`,
                "Pago importado desde reporte de recibos pagados.",
                evidenceKey,
                state.importUser,
              ],
            );
            state.paymentSourceEvidenceKeys.add(evidenceKey);
          }
        }
      }
    }

    pushSummary(report, "Clientes acciones crear", countAction(report.clients, "CREAR", "CREARIA"));
    pushSummary(report, "Aseguradoras acciones crear", countAction(report.insurers, "CREAR", "CREARIA"));
    pushSummary(report, "Pólizas acciones crear", countAction(report.policies, "CREAR", "CREARIA"));
    pushSummary(report, "Pólizas acciones actualizar", countAction(report.policies, "ACTUALIZAR", "ACTUALIZARIA"));
    pushSummary(report, "Recibos acciones crear", countAction(report.receipts, "CREAR", "CREARIA"));
    pushSummary(report, "Recibos acciones actualizar", countAction(report.receipts, "ACTUALIZAR", "ACTUALIZARIA"));
    pushSummary(report, "Pagos acciones crear", countAction(report.payments, "CREAR", "CREARIA"));
    pushSummary(report, "Ambiguos", report.ambiguous.length);
    pushSummary(report, "Omitidos", report.skipped.length);
    pushSummary(report, "Errores", report.errors.length);

    if (args.mode === "apply") {
      await db.query("commit");
      try {
        await db.query(
          'insert into public."ActivityLog" (id, "entityType", "entityId", action, "newValue", "createdAt", "userId") values ($1,$2,$3,$4,$5,now(),$6)',
          [
            id(),
            "IMPORT",
            "policy-ledger",
            "IMPORT_POLICY_LEDGER",
            JSON.stringify(Object.fromEntries(report.summary.map((row) => [row.Metrica, row.Valor]))),
            state.importUser,
          ],
        );
      } catch (activityLogError) {
        console.warn("No se pudo registrar ActivityLog del import, pero la importación ya quedó guardada.", activityLogError);
      }
    }

    if (args.exportReport) {
      const reportPath = await writeReport(report, args.mode);
      pushSummary(report, "Reporte", reportPath);
      console.log(`Reporte: ${reportPath}`);
    }

    printReport(report, backupPath);
  } catch (error) {
    if (args.mode === "apply") {
      try {
        await db.query("rollback");
      } catch {
        // ignore rollback failure so the original error remains visible
      }
    }
    throw error;
  } finally {
    await db.end();
  }
}

function countAction(rows: ReportRow[], applyAction: string, dryRunAction: string) {
  return rows.filter((row) => row.Accion === applyAction || row.Accion === dryRunAction).length;
}

async function resolveDuplicatePoliciesForImport(params: {
  db: PgClient;
  apply: boolean;
  sourcePolicyNumber: string;
  policies: ExistingPolicy[];
  receipts: ExistingReceipt[];
  report: ImportReport;
  importUser: string;
}) {
  const sourceClean = cleanText(params.sourcePolicyNumber);
  const canonical =
    params.policies.find((policy) => cleanText(policy.policyNumber) === sourceClean) ??
    params.policies.find((policy) => /^0+\d+$/.test(cleanText(policy.policyNumber))) ??
    params.policies[0];

  const duplicates = params.policies.filter((policy) => policy.id !== canonical.id);
  const compatible = params.policies.every(
    (policy) =>
      policy.clientId === canonical.clientId &&
      policy.insurerId === canonical.insurerId &&
      sameDate(policy.startDate, canonical.startDate) &&
      sameDate(policy.endDate, canonical.endDate) &&
      sameMoney(policy.premiumAmount, Number(canonical.premiumAmount)),
  );

  if (!compatible) {
    params.report.ambiguous.push({
      Entidad: "Póliza",
      Llave: normalizePolicyNumber(sourceClean),
      Motivo: "Duplicados no idénticos; requiere revisión manual",
      Coincidencias: params.policies.map((policy) => policy.policyNumber).join(" | "),
    });
    return null;
  }

  const duplicateIds = duplicates.map((policy) => policy.id);
  const relationCounts = await params.db.query<{
    id: string;
    payments: number;
    commissions: number;
    workItems: number;
    claims: number;
  }>(
    `select p.id,
      count(distinct pay.id)::int as payments,
      count(distinct co.id)::int as commissions,
      count(distinct wi.id)::int as workItems,
      count(distinct cl.id)::int as claims
    from public."Policy" p
    left join public."Payment" pay on pay."policyId" = p.id
    left join public."Commission" co on co."policyId" = p.id
    left join public."WorkItem" wi on wi."policyId" = p.id and wi."workItemType" = 'TASK'
    left join public."Claim" cl on cl."policyId" = p.id
    where p.id = any($1)
    group by p.id`,
    [duplicateIds],
  );

  const unsafeRelations = relationCounts.rows.filter(
    (row) => row.payments || row.commissions || row.workItems || row.claims,
  );

  if (unsafeRelations.length) {
    params.report.ambiguous.push({
      Entidad: "Póliza",
      Llave: normalizePolicyNumber(sourceClean),
      Motivo: "Duplicados con pagos/comisiones/pendientes/siniestros; no se fusionan automáticamente",
      Coincidencias: params.policies.map((policy) => policy.policyNumber).join(" | "),
    });
    return null;
  }

  const canonicalReceiptKeys = new Set(
    params.receipts
      .filter((receipt) => receipt.policyId === canonical.id)
      .map((receipt) => [receipt.receiptNumber, dateKey(receipt.periodStartDate), dateKey(receipt.periodEndDate), Math.round(Number(receipt.amount) * 100)].join("|")),
  );
  const duplicateReceipts = params.receipts.filter((receipt) => duplicateIds.includes(receipt.policyId));
  const receiptCopiesAreSafe = duplicateReceipts.every((receipt) =>
    canonicalReceiptKeys.has(
      [receipt.receiptNumber, dateKey(receipt.periodStartDate), dateKey(receipt.periodEndDate), Math.round(Number(receipt.amount) * 100)].join("|"),
    ),
  );

  if (!receiptCopiesAreSafe) {
    params.report.ambiguous.push({
      Entidad: "Póliza",
      Llave: normalizePolicyNumber(sourceClean),
      Motivo: "Los recibos duplicados no coinciden exactamente con la póliza canónica",
      Coincidencias: params.policies.map((policy) => policy.policyNumber).join(" | "),
    });
    return null;
  }

  const duplicateDocs = await params.db.query<{ id: string; fileName: string; documentType: string }>(
    'select id, "fileName", "documentType" from public."Document" where "policyId" = any($1)',
    [duplicateIds],
  );
  const canonicalDocs = await params.db.query<{ fileName: string; documentType: string }>(
    'select "fileName", "documentType" from public."Document" where "policyId" = $1',
    [canonical.id],
  );
  const canonicalDocKeys = new Set(
    canonicalDocs.rows.map((doc) => [normalizeName(doc.fileName), doc.documentType].join("|")),
  );
  const docsToDelete = duplicateDocs.rows.filter((doc) =>
    canonicalDocKeys.has([normalizeName(doc.fileName), doc.documentType].join("|")),
  );
  const docsToMove = duplicateDocs.rows.filter((doc) => !docsToDelete.some((deleted) => deleted.id === doc.id));

  params.report.policies.push({
    Accion: params.apply ? "FUSIONAR_DUPLICADO" : "FUSIONARIA_DUPLICADO",
    Poliza: canonical.policyNumber,
    Duplicados: duplicates.map((policy) => policy.policyNumber).join(" | "),
    RecibosDuplicados: duplicateReceipts.length,
    DocumentosDuplicadosEliminados: docsToDelete.length,
    DocumentosMovidos: docsToMove.length,
  });

  if (params.apply) {
    for (const doc of docsToMove) {
      await params.db.query('update public."Document" set "policyId" = $1, "updatedAt" = now(), "updatedById" = $2 where id = $3', [
        canonical.id,
        params.importUser,
        doc.id,
      ]);
    }
    for (const doc of docsToDelete) {
      await params.db.query('delete from public."Document" where id = $1', [doc.id]);
    }
    for (const duplicate of duplicates) {
      await params.db.query('delete from public."Policy" where id = $1', [duplicate.id]);
    }
  }

  return { canonical, duplicateIds };
}

async function writeReport(report: ImportReport, mode: Mode) {
  await fs.mkdir(EXPORTS_DIR, { recursive: true });
  const filePath = path.join(EXPORTS_DIR, `policy-ledger-import-${mode}-${timestampForFile()}.xlsx`);
  const workbook = XLSX.utils.book_new();

  for (const [name, rows] of [
    ["Resumen", report.summary],
    ["Clientes", report.clients],
    ["Aseguradoras", report.insurers],
    ["Polizas", report.policies],
    ["Recibos", report.receipts],
    ["Pagos", report.payments],
    ["Ambiguos", report.ambiguous],
    ["Omitidos", report.skipped],
    ["Errores", report.errors],
  ] as Array<[string, ReportRow[]]>) {
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Nota: "Sin filas" }]);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function printReport(report: ImportReport, backupPath: string) {
  const summary = Object.fromEntries(report.summary.map((row) => [String(row.Metrica), row.Valor]));
  console.log("");
  console.log("Importación de pólizas/recibos/pagos");
  if (backupPath) console.log(`Backup: ${backupPath}`);
  for (const [key, value] of Object.entries(summary)) {
    console.log(`${key}: ${value}`);
  }
  if (report.ambiguous.length) {
    console.log("");
    console.log("Ambiguos principales:");
    for (const row of report.ambiguous.slice(0, 10)) {
      console.log(`- ${row.Entidad}: ${row.Llave} (${row.Motivo})`);
    }
  }
}

const args = parseArgs();
runImport(args).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
