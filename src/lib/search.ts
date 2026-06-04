import { getDb } from "@/lib/db";
import { normalize, unaccentSql } from "@/lib/search-utils";
import { Prisma } from "@/generated/prisma/client";

export { normalize, unaccentSql };

export type SearchMatch = {
  field: string;
  fieldLabel: string;
  snippet: string;
};

export type GlobalSearchResult = {
  id: string;
  type: "client" | "policy" | "receipt" | "workItem" | "claim" | "quote" | "insurer" | "document";
  title: string;
  subtitle?: string;
  parentLabel?: string;
  href: string;
  match?: SearchMatch;
};

const SNIPPET_RADIUS = 40;

function buildSnippet(rawText: string | null | undefined, needle: string): string {
  if (!rawText) return "";
  const normalized = normalize(rawText);
  const idx = normalized.indexOf(needle);
  if (idx < 0) {
    return rawText.length > SNIPPET_RADIUS * 2 ? rawText.slice(0, SNIPPET_RADIUS * 2) + "…" : rawText;
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(rawText.length, idx + needle.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < rawText.length ? "…" : "";
  return prefix + rawText.slice(start, end) + suffix;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "nombre",
  email: "correo",
  phone: "teléfono",
  rfc: "RFC",
  address: "dirección",
  notes: "notas",
  policyNumber: "póliza",
  insuredObject: "objeto asegurado",
  insuredPartiesText: "asegurado",
  insuredAssetsText: "activo",
  receiptNumber: "recibo",
  title: "título",
  folio: "folio",
  claimType: "tipo",
  taskType: "tipo",
  name: "nombre",
  contactName: "contacto",
  fileName: "archivo",
};

function pickMatch(row: Record<string, unknown>, fields: string[], needle: string): SearchMatch | undefined {
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && normalize(v).includes(needle)) {
      return {
        field: f,
        fieldLabel: FIELD_LABELS[f] ?? f,
        snippet: buildSnippet(v, needle),
      };
    }
  }
  return undefined;
}

type RowWithId = Record<string, unknown> & { id: string };

type SearchTable =
  | "Client"
  | "Policy"
  | "Receipt"
  | "WorkItem"
  | "Claim"
  | "Quote"
  | "Insurer"
  | "Document";

const ALLOWED_COLUMNS = new Set([
  "id",
  "fullName",
  "email",
  "phone",
  "rfc",
  "address",
  "notes",
  "policyNumber",
  "policyType",
  "insuredObject",
  "insuredPartiesText",
  "insuredAssetsText",
  "receiptNumber",
  "status",
  "folio",
  "title",
  "claimType",
  "taskType",
  "name",
  "contactName",
  "fileName",
  "documentType",
  "clientId",
  "policyId",
  "claimId",
  "receiptId",
  "taskId",
  "quoteId",
  "sourceType",
  "sourceId",
  "assignedToId",
  "portfolioOwnerId",
  "updatedAt",
]);

function assertAllowedIdentifier(value: string) {
  if (!ALLOWED_COLUMNS.has(value)) {
    throw new Error(`Unsafe search column: ${value}`);
  }
}

async function rawSearch<T extends RowWithId>(
  table: SearchTable,
  selectCols: string[],
  searchCols: string[],
  needle: string,
  limit = 5,
  orderBy?: Prisma.Sql,
  extraSelect: Prisma.Sql = Prisma.empty,
  extraWhere?: Prisma.Sql,
  scopeWhere?: Prisma.Sql,
): Promise<T[]> {
  const db = getDb();

  assertAllowedIdentifier("updatedAt");
  for (const column of [...selectCols, ...searchCols]) {
    assertAllowedIdentifier(column);
  }

  const tableSql = Prisma.raw(`"${table}"`);
  const cols = Prisma.join(selectCols.map((column) => Prisma.raw(`"${column}"`)), ", ");
  const where = Prisma.join(
    searchCols.map((column) => Prisma.sql`${Prisma.raw(unaccentSql(column))} LIKE ${`%${needle}%`}`),
    " OR ",
  );
  const searchWhere = extraWhere ? Prisma.sql`(${where}) OR (${extraWhere})` : Prisma.sql`(${where})`;

  const orderBySql = orderBy ?? Prisma.sql`ORDER BY ${Prisma.raw('"updatedAt"')} DESC`;
  const combinedWhere = scopeWhere ? Prisma.sql`(${searchWhere}) AND ${scopeWhere}` : searchWhere;
  const sql = Prisma.sql`SELECT ${cols}${extraSelect} FROM ${tableSql} WHERE ${combinedWhere} ${orderBySql} LIMIT ${limit}`;
  return (await db.$queryRaw<T[]>(sql)) as T[];
}

export async function globalSearch(query: string, portfolioOwnerId?: string): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const needle = normalize(q);
  if (!needle) return [];

  const scopedClientWhere = portfolioOwnerId ? Prisma.sql`"portfolioOwnerId" = ${portfolioOwnerId}` : undefined;
  const scopedPolicyWhere = portfolioOwnerId
    ? Prisma.sql`EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Policy"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})`
    : undefined;
  const scopedReceiptWhere = portfolioOwnerId
    ? Prisma.sql`EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Receipt"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})`
    : undefined;
  const scopedWorkItemWhere = portfolioOwnerId
    ? Prisma.sql`(
      EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "WorkItem"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})
      OR ("WorkItem"."clientId" IS NULL AND "WorkItem"."assignedToId" = ${portfolioOwnerId})
    )`
    : undefined;
  const scopedClaimWhere = portfolioOwnerId
    ? Prisma.sql`EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Claim"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})`
    : undefined;
  const scopedQuoteWhere = portfolioOwnerId
    ? Prisma.sql`EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Quote"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})`
    : undefined;
  const scopedDocumentWhere = portfolioOwnerId
    ? Prisma.sql`(
      EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Document"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId})
      OR EXISTS (SELECT 1 FROM "Policy" WHERE "Policy"."id" = "Document"."policyId" AND EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Policy"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId}))
      OR EXISTS (SELECT 1 FROM "Receipt" WHERE "Receipt"."id" = "Document"."receiptId" AND EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Receipt"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId}))
      OR EXISTS (SELECT 1 FROM "Claim" WHERE "Claim"."id" = "Document"."claimId" AND EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Claim"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId}))
      OR EXISTS (SELECT 1 FROM "Quote" WHERE "Quote"."id" = "Document"."quoteId" AND EXISTS (SELECT 1 FROM "Client" WHERE "Client"."id" = "Quote"."clientId" AND "Client"."portfolioOwnerId" = ${portfolioOwnerId}))
    )`
    : undefined;

  const results: GlobalSearchResult[] = [];

  type ClientRow = RowWithId & { fullName: string; email: string | null; phone: string | null; rfc: string | null; address: string | null; notes: string | null };
  type PolicyRow = RowWithId & {
    policyNumber: string;
    policyType: string;
    insuredObject: string | null;
    insuredPartiesText: string | null;
    insuredAssetsText: string | null;
    notes: string | null;
    clientId: string;
    clientName: string | null;
  };
  type ReceiptRow = RowWithId & { receiptNumber: string; status: string; clientName: string | null };
  type WorkItemRow = RowWithId & {
    sourceType: string;
    sourceId: string;
    folio: string | null;
    title: string;
    taskType: string | null;
    status: string;
    notes: string | null;
    clientName: string | null;
  };
  type ClaimRow = RowWithId & { folio: string; claimType: string; notes: string | null; clientName: string | null };
  type QuoteRow = RowWithId & { policyType: string; notes: string | null; clientName: string | null };
  type InsurerRow = RowWithId & { name: string; contactName: string | null; notes: string | null };
  type DocumentRow = RowWithId & {
    fileName: string;
    documentType: string;
    notes: string | null;
    clientId: string | null;
    policyId: string | null;
    claimId: string | null;
    receiptId: string | null;
    taskId: string | null;
    quoteId: string | null;
    parentLabel: string | null;
  };

  const [clients, policies, receipts, workItems, claims, quotes, insurers, documents] = await Promise.all([
    rawSearch<ClientRow>(
      "Client",
      ["id", "fullName", "email", "phone", "rfc", "address", "notes", "updatedAt"],
      ["fullName", "email", "phone", "rfc", "address", "notes"],
      needle,
      5,
      undefined,
      Prisma.empty,
      undefined,
      scopedClientWhere,
    ),
    rawSearch<PolicyRow>(
      "Policy",
      ["id", "policyNumber", "policyType", "insuredObject", "notes", "clientId", "updatedAt"],
      ["policyNumber", "insuredObject", "notes"],
      needle,
      5,
      Prisma.sql`ORDER BY ${Prisma.raw('"endDate"')} DESC, ${Prisma.raw('"startDate"')} DESC, ${Prisma.raw('"updatedAt"')} DESC`,
      Prisma.sql`,
        (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Policy"."clientId") AS "clientName",
        (
          SELECT string_agg("fullName", ' | ')
          FROM "PolicyInsuredParty"
          WHERE "PolicyInsuredParty"."policyId" = "Policy"."id"
        ) AS "insuredPartiesText",
        (
          SELECT string_agg("description", ' | ')
          FROM "PolicyInsuredAsset"
          WHERE "PolicyInsuredAsset"."policyId" = "Policy"."id"
        ) AS "insuredAssetsText"`,
      Prisma.sql`EXISTS (
        SELECT 1
        FROM "PolicyInsuredParty"
        WHERE "PolicyInsuredParty"."policyId" = "Policy"."id"
          AND ${Prisma.raw(unaccentSql('"PolicyInsuredParty"."fullName"'))} LIKE ${`%${needle}%`}
      ) OR EXISTS (
        SELECT 1
        FROM "PolicyInsuredAsset"
        WHERE "PolicyInsuredAsset"."policyId" = "Policy"."id"
          AND ${Prisma.raw(unaccentSql('"PolicyInsuredAsset"."description"'))} LIKE ${`%${needle}%`}
      )`,
      scopedPolicyWhere,
    ),
    rawSearch<ReceiptRow>(
      "Receipt",
      ["id", "receiptNumber", "status", "updatedAt"],
      ["receiptNumber"],
      needle,
      5,
      undefined,
      Prisma.sql`, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Receipt"."clientId") AS "clientName"`,
      undefined,
      scopedReceiptWhere,
    ),
    rawSearch<WorkItemRow>(
      "WorkItem",
      ["id", "sourceType", "sourceId", "folio", "title", "taskType", "status", "notes", "updatedAt"],
      ["sourceType", "sourceId", "folio", "title", "taskType", "notes"],
      needle,
      5,
      undefined,
      Prisma.sql`, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "WorkItem"."clientId") AS "clientName"`,
      undefined,
      scopedWorkItemWhere,
    ),
    rawSearch<ClaimRow>(
      "Claim",
      ["id", "folio", "claimType", "notes", "updatedAt"],
      ["folio", "claimType", "notes"],
      needle,
      5,
      undefined,
      Prisma.sql`, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Claim"."clientId") AS "clientName"`,
      undefined,
      scopedClaimWhere,
    ),
    rawSearch<QuoteRow>(
      "Quote",
      ["id", "policyType", "notes", "updatedAt"],
      ["id", "notes"],
      needle,
      5,
      undefined,
      Prisma.sql`, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Quote"."clientId") AS "clientName"`,
      undefined,
      scopedQuoteWhere,
    ),
    rawSearch<InsurerRow>(
      "Insurer",
      ["id", "name", "contactName", "notes", "updatedAt"],
      ["name", "contactName", "notes"],
      needle,
      5,
      undefined,
    ),
    rawSearch<DocumentRow>(
      "Document",
      ["id", "fileName", "documentType", "notes", "clientId", "policyId", "claimId", "receiptId", "taskId", "quoteId", "updatedAt"],
      ["fileName", "notes"],
      needle,
      5,
      undefined,
      Prisma.sql`, COALESCE(
          (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Document"."clientId"),
          (SELECT "policyNumber" FROM "Policy" WHERE "Policy"."id" = "Document"."policyId"),
          (SELECT "folio" FROM "Claim" WHERE "Claim"."id" = "Document"."claimId"),
          (SELECT "receiptNumber" FROM "Receipt" WHERE "Receipt"."id" = "Document"."receiptId")
        ) AS "parentLabel"`,
      undefined,
      scopedDocumentWhere,
    ),
  ]);

  for (const c of clients) {
    const match = pickMatch(c, ["fullName", "email", "phone", "rfc", "address", "notes"], needle);
    results.push({
      id: c.id,
      type: "client",
      title: c.fullName,
      subtitle: c.email || c.phone || "Sin contacto",
      href: `/clients/${c.id}`,
      match,
    });
  }

  for (const p of policies) {
    const match = pickMatch(p, ["policyNumber", "insuredObject", "insuredPartiesText", "insuredAssetsText", "notes"], needle);
    results.push({
      id: p.id,
      type: "policy",
      title: p.policyNumber,
      subtitle: `${p.clientName ?? "Sin cliente"} · ${p.policyType}`,
      href: `/policies/${p.id}`,
      match,
    });
  }

  for (const r of receipts) {
    const match = pickMatch(r, ["receiptNumber"], needle);
    results.push({
      id: r.id,
      type: "receipt",
      title: r.receiptNumber,
      subtitle: `${r.clientName ?? "Sin cliente"} · ${r.status}`,
      href: `/receipts/${r.id}`,
      match,
    });
  }

  for (const w of workItems) {
    const match = pickMatch(w, ["sourceType", "sourceId", "folio", "title", "taskType", "notes"], needle);
    results.push({
      id: w.id,
      type: "workItem",
      title: w.title,
      subtitle: `${w.clientName ?? "Sin cliente"} · ${w.status}`,
      href: `/tasks/${w.sourceId ?? w.id}`,
      match,
    });
  }

  for (const cl of claims) {
    const match = pickMatch(cl, ["folio", "claimType", "notes"], needle);
    results.push({
      id: cl.id,
      type: "claim",
      title: cl.folio,
      subtitle: `${cl.clientName ?? "Sin cliente"} · ${cl.claimType}`,
      href: `/claims/${cl.id}`,
      match,
    });
  }

  for (const q of quotes) {
    const match = pickMatch(q, ["id", "notes"], needle);
    results.push({
      id: q.id,
      type: "quote",
      title: q.id.slice(0, 8),
      subtitle: `${q.clientName ?? "Sin cliente"} · ${q.policyType}`,
      href: `/quotes/${q.id}`,
      match,
    });
  }

  for (const ins of insurers) {
    const match = pickMatch(ins, ["name", "contactName", "notes"], needle);
    results.push({
      id: ins.id,
      type: "insurer",
      title: ins.name,
      subtitle: ins.contactName || "Sin contacto",
      href: `/insurers/${ins.id}`,
      match,
    });
  }

  for (const d of documents) {
    const match = pickMatch(d, ["fileName", "notes"], needle);
    let href = "/documents";
    let subtitle = `${d.documentType}`;
    if (d.clientId) href = `/clients/${d.clientId}`;
    else if (d.policyId) href = `/policies/${d.policyId}`;
    else if (d.claimId) href = `/claims/${d.claimId}`;
    else if (d.receiptId) href = `/receipts/${d.receiptId}`;
    if (d.parentLabel) subtitle = `${d.documentType} · ${d.parentLabel}`;
    results.push({
      id: d.id,
      type: "document",
      title: d.fileName,
      subtitle,
      parentLabel: d.parentLabel ?? undefined,
      href,
      match,
    });
  }

  return results;
}
