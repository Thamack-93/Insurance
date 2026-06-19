import fs from "node:fs";
import path from "node:path";

import * as XLSX from "@e965/xlsx";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const localEnvPath = path.join(process.cwd(), ".env.local");
function loadLocalEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnvFile(localEnvPath);

const csvPath = process.argv[2] ?? "/Users/pedrogomez/Downloads/DescargaSAPS.csv";
const pagosPath = process.argv[3] ?? "/Users/pedrogomez/Downloads/pagos.csv";
const STATUS_MAP: Record<string, string> = {
  PAGADO: "PAID",
  PENDIENTE: "PENDING",
  CANCELADO: "CANCELLED",
  VENCIDO: "OVERDUE",
  PARCIAL: "PARTIAL",
};

function n(v: unknown) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const c = String(v).replace(/[$,\s]/g, "");
  const x = Number(c);
  return Number.isFinite(x) ? x : 0;
}
function t(v: unknown) { return v == null ? "" : String(v).trim(); }
function normKey(s: string) { return s.replace(/[^0-9a-z]/gi, "").toUpperCase(); }
function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}
function fmt(d: Date | string | null) {
  if (!d) return "-";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function money(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

// --- Load CSV ---
const csvWb = XLSX.readFile(csvPath, { cellDates: false, raw: true });
const csvRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
  csvWb.Sheets[csvWb.SheetNames[0]!]!,
  { defval: "", raw: true },
);
type CsvReceipt = {
  policyKey: string;
  policyNumber: string;
  receiptNumber: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  netAmount: number;
  totalAmount: number;
  csvStatus: string;
};
const csv: CsvReceipt[] = csvRows
  .map((r) => {
    const pn = t(r["No. de Póliza"]);
    if (!pn) return null;
    return {
      policyKey: normKey(pn),
      policyNumber: pn,
      receiptNumber: t(r["No. Recibo"]),
      periodStart: parseDate(r["Ini Vigencia Rec"]),
      periodEnd: parseDate(r["Fin Vigencia Rec"]),
      dueDate: null,
      netAmount: n(r["Prima Neta Recibo"]),
      totalAmount: n(r["Prima Total Recibo"]),
      csvStatus: STATUS_MAP[t(r["Estatus"]).toUpperCase()] ?? t(r["Estatus"]).toUpperCase(),
    };
  })
  .filter((r): r is CsvReceipt => r !== null);

// Build CSV lookup: policyKey+receiptNumber -> CsvReceipt (last wins on duplicates)
const csvByKey = new Map<string, CsvReceipt>();
for (const r of csv) csvByKey.set(`${r.policyKey}|${r.receiptNumber}`, r);

// --- Load pagos ---
const pagosBuf = fs.readFileSync(pagosPath);
const pagosWb = XLSX.read(pagosBuf, { cellDates: true, type: "buffer" });
const pagosRowsAll = XLSX.utils.sheet_to_json<Record<string, unknown>>(
  pagosWb.Sheets[pagosWb.SheetNames[0]!]!,
  { defval: "", raw: true },
);
// Data starts at index 4 (rows 0-3 are headers/report)
const pagosDataRows = pagosRowsAll.slice(4);

type PagosRow = {
  policyKey: string;
  policyNumber: string;
  receiptNumber: string;
  fechaPago: Date | null;
  netPag: number;   // payment without iva
  pagada: number;   // prima total pagada
  endoso: string;
  isRefund: boolean;
  isEndorsement: boolean;
};
const pagos: PagosRow[] = [];
let droppedRefund = 0;
let droppedEndorsement = 0;
let droppedNoPolicy = 0;
for (const r of pagosDataRows) {
  const pn = t(r["J 18, 2026"]);
  if (!pn) {
    droppedNoPolicy++;
    continue;
  }
  const endoso = t(r["__EMPTY_1"]);
  const netPag = n(r["__EMPTY_11"]);
  const isRefund = netPag < 0;
  const isEndorsement = endoso !== "" && endoso !== "0";
  if (isRefund) {
    droppedRefund++;
    continue;
  }
  if (isEndorsement) {
    droppedEndorsement++;
    continue;
  }
  const rn = String(r["__EMPTY_2"] ?? "").trim();
  if (!rn) continue;
  pagos.push({
    policyKey: normKey(pn),
    policyNumber: pn,
    receiptNumber: rn,
    fechaPago: parseDate(r["__EMPTY_10"]),
    netPag,
    pagada: n(r["__EMPTY_12"]),
    endoso,
    isRefund,
    isEndorsement,
  });
}

console.log("=== PAGOS FILTERING ===");
console.log(`Total pagos data rows:     ${pagosDataRows.length}`);
console.log(`Dropped (no policy):       ${droppedNoPolicy}`);
console.log(`Dropped (refunds):         ${droppedRefund}`);
console.log(`Dropped (endorsements):    ${droppedEndorsement}`);
console.log(`Valid for matching:        ${pagos.length}`);

type DbPolicy = {
  id: string;
  policyNumber: string;
  status: string;
  client: { fullName: string };
  insurer: { name: string };
  receipts: Array<{
    id: string;
    receiptNumber: string;
    amount: unknown;
    status: string;
    paidDate: Date | null;
    periodStartDate: Date;
    periodEndDate: Date;
    dueDate: Date;
  }>;
};

type DbReceiptMatch = {
  receipt: DbPolicy["receipts"][number];
  policy: DbPolicy;
};

type Finding = {
  policyNumber: string;
  client: string;
  insurer: string;
  receipt: string;
  csvStatus: string;
  csvTotal: number;
  dbStatus: string;
  dbAmount: number;
  dbPaidDate: string;
  pagosNetPag: number;
  pagosPagada: number;
  pagosFechaPago: string;
  category: string;
  notes: string;
};

async function loadPoliciesByKey(policyKeys: string[]) {
  // Build variants: "940451814" may be stored as "0940451814" with leading zeros
  function padVariants(k: string): string[] {
    const out = [k];
    for (let i = 1; i <= 5; i++) out.push("0".repeat(i) + k);
    return out;
  }
  const policyVariants = new Set<string>();
  for (const k of policyKeys) for (const v of padVariants(k)) policyVariants.add(v);

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!.trim() }) });
  try {
    const dbPolicies = await db.policy.findMany({
      where: { policyNumber: { in: [...policyVariants], mode: "insensitive" as const } },
      select: {
        id: true,
        policyNumber: true,
        status: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            amount: true,
            status: true,
            paidDate: true,
            periodStartDate: true,
            periodEndDate: true,
            dueDate: true,
          },
        },
      },
    });

    const policiesByKey = new Map<string, DbPolicy[]>();
    const receiptsByKey = new Map<string, DbReceiptMatch>();

    for (const policy of dbPolicies as DbPolicy[]) {
      const policyKey = normKey(policy.policyNumber);
      const existingPolicies = policiesByKey.get(policyKey) ?? [];
      existingPolicies.push(policy);
      policiesByKey.set(policyKey, existingPolicies);

      for (const receipt of policy.receipts) {
        const matchKey = `${policyKey}|${receipt.receiptNumber}`;
        if (!receiptsByKey.has(matchKey)) {
          receiptsByKey.set(matchKey, { receipt, policy });
        }
      }
    }

    return { policiesByKey, receiptsByKey };
  } finally {
    await db.$disconnect();
  }
}

function comparePaymentRow(
  p: PagosRow,
  csvR: CsvReceipt | undefined,
  dbMatch: DbReceiptMatch | undefined,
  client: string,
  insurer: string,
): Finding {
  const csvStatus = csvR?.csvStatus ?? "(no CSV)";
  const csvTotal = csvR?.totalAmount ?? 0;
  const dbStatus = dbMatch?.receipt.status ?? "(missing)";
  const dbAmount = dbMatch ? Number(dbMatch.receipt.amount) : 0;
  const dbPaidDate = dbMatch?.receipt.paidDate ? fmt(dbMatch.receipt.paidDate) : "-";
  const pagosFechaPago = p.fechaPago ? fmt(p.fechaPago) : "-";

  let category = "OK";
  const notes: string[] = [];
  const pagosSaysPaid = p.fechaPago !== null;

  if (!dbMatch) {
    category = "MISSING_IN_DB";
    notes.push("DB has no receipt for (policy, receipt) key");
  } else {
    const dbSaysPaid = dbStatus === "PAID";
    const dbSaysCancelled = dbStatus === "CANCELLED";

    if (pagosSaysPaid && dbSaysCancelled) {
      category = "STATUS_MISMATCH";
      notes.push("pagos=paid, DB=cancelled (possible: agent got refund but DB marked as cancel?)");
    } else if (pagosSaysPaid && !dbSaysPaid) {
      category = "STATUS_MISMATCH";
      notes.push(`pagos=paid (${pagosFechaPago}), DB=${dbStatus} (likely DB needs update to PAID)`);
    } else if (!pagosSaysPaid && dbSaysPaid) {
      category = "STATUS_MISMATCH";
      notes.push("DB=paid, pagos=not in 2026 file (may be 2025 or older — keep DB)");
    } else if (pagosSaysPaid && dbSaysPaid) {
      if (p.fechaPago && dbMatch.receipt.paidDate) {
        const diff = Math.abs(p.fechaPago.getTime() - dbMatch.receipt.paidDate.getTime()) / 86400000;
        if (diff > 7) {
          category = "PAIDDATE_MISMATCH";
          notes.push(`paidDate differs by ${diff.toFixed(0)} days (pagos=${pagosFechaPago}, DB=${dbPaidDate})`);
        }
      } else if (p.fechaPago && !dbMatch.receipt.paidDate) {
        category = "STATUS_MISMATCH";
        notes.push("both say paid, but DB has no paidDate");
      }
    }

    const diffPagadaDb = Math.abs(p.pagada - dbAmount);
    if (diffPagadaDb > 1) {
      if (category === "OK") category = "AMOUNT_MISMATCH";
      notes.push(`pagosPagada ${money(p.pagada)} vs DB ${money(dbAmount)} (Δ ${money(p.pagada - dbAmount)})`);
    }
  }

  return {
    policyNumber: p.policyNumber,
    client,
    insurer,
    receipt: p.receiptNumber,
    csvStatus,
    csvTotal,
    dbStatus,
    dbAmount,
    dbPaidDate,
    pagosNetPag: p.netPag,
    pagosPagada: p.pagada,
    pagosFechaPago,
    category,
    notes: notes.join(" | "),
  };
}

async function main() {
  const policyKeys = [...new Set(pagos.map((p) => p.policyKey))];
  const { policiesByKey, receiptsByKey } = await loadPoliciesByKey(policyKeys);
  const findings: Finding[] = [];

  let okCount = 0;
  let statusMismatch = 0;
  let amountMismatch = 0;
  let missingInDb = 0;
  let other = 0;

  for (const p of pagos) {
    const key = `${p.policyKey}|${p.receiptNumber}`;
    const csvR = csvByKey.get(key);
    const dbMatch = receiptsByKey.get(key);
    const dbPoliciesForKey = policiesByKey.get(p.policyKey);
    const client = dbPoliciesForKey?.[0]?.client.fullName ?? "(no DB match)";
    const insurer = dbPoliciesForKey?.[0]?.insurer.name ?? "(no DB match)";
    const finding = comparePaymentRow(p, csvR, dbMatch, client, insurer);

    if (finding.category === "OK") {
      okCount++;
    } else {
      other++;
      if (finding.category === "MISSING_IN_DB") missingInDb++;
      if (finding.category === "STATUS_MISMATCH" || finding.category === "PAIDDATE_MISMATCH") statusMismatch++;
      if (finding.category === "AMOUNT_MISMATCH") amountMismatch++;
    }

    findings.push(finding);
  }

  const grouped: Record<string, Finding[]> = {
    MISSING_IN_DB: [],
    STATUS_MISMATCH: [],
    PAIDDATE_MISMATCH: [],
    AMOUNT_MISMATCH: [],
    OK: [],
  };
  for (const finding of findings) grouped[finding.category].push(finding);

  console.log("\n=== RECONCILIATION SUMMARY ===");
  console.log(`Total pagos rows compared: ${findings.length}`);
  console.log(`OK (no action):            ${okCount}`);
  console.log(`Missing in DB:            ${missingInDb}`);
  console.log(`Status mismatch:           ${statusMismatch}`);
  console.log(`Amount mismatch:           ${amountMismatch}`);
  console.log(`Other findings:            ${other}`);

  const printTable = (title: string, rows: Finding[]) => {
    if (rows.length === 0) return;
    console.log(`\n=== ${title} (${rows.length}) ===`);
    for (const r of rows) {
      console.log(`\n[${r.policyNumber} | ${r.receipt}] ${r.client} · ${r.insurer}`);
      console.log(`  CSV: status=${r.csvStatus}`);
      console.log(`  DB : status=${r.dbStatus} amount=${r.dbAmount} paidDate=${r.dbPaidDate}`);
      console.log(`  PAG: netPag=${money(r.pagosNetPag)} pagada=${money(r.pagosPagada)} fechaPago=${r.pagosFechaPago}`);
      console.log(`  → ${r.category}: ${r.notes}`);
    }
  };

  printTable("MISSING IN DB", grouped.MISSING_IN_DB);
  printTable("STATUS MISMATCH (pagos vs DB)", grouped.STATUS_MISMATCH);
  printTable("PAID DATE MISMATCH", grouped.PAIDDATE_MISMATCH);
  printTable("AMOUNT MISMATCH", grouped.AMOUNT_MISMATCH);
  printTable("OK (no action needed)", grouped.OK);
}

main().catch((e) => { console.error(e); process.exit(1); });
