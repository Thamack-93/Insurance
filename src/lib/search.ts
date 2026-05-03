import { getDb } from "@/lib/db";
import { normalize, unaccentSql } from "@/lib/search-utils";

export { normalize, unaccentSql };

export type SearchMatch = {
  field: string;
  fieldLabel: string;
  snippet: string;
};

export type GlobalSearchResult = {
  id: string;
  type: "client" | "policy" | "receipt" | "task" | "claim" | "quote" | "insurer" | "document";
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
  receiptNumber: "recibo",
  title: "título",
  folio: "folio",
  claimType: "tipo",
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

async function rawSearch<T extends RowWithId>(
  table: string,
  selectCols: string[],
  searchCols: string[],
  needle: string,
  limit = 5,
  extraSelect = "",
): Promise<T[]> {
  const db = getDb();
  const where = searchCols.map((c) => `${unaccentSql(c)} LIKE ?`).join(" OR ");
  const cols = selectCols.map((c) => `"${c}"`).join(", ");
  const sql = `SELECT ${cols}${extraSelect} FROM "${table}" WHERE ${where} ORDER BY "updatedAt" DESC LIMIT ${limit}`;
  const params = Array.from({ length: searchCols.length }, () => `%${needle}%`);
  return (await db.$queryRawUnsafe(sql, ...params)) as T[];
}

export async function globalSearch(query: string): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const needle = normalize(q);
  if (!needle) return [];

  const results: GlobalSearchResult[] = [];

  type ClientRow = RowWithId & { fullName: string; email: string | null; phone: string | null; rfc: string | null; address: string | null; notes: string | null };
  type PolicyRow = RowWithId & { policyNumber: string; policyType: string; insuredObject: string | null; notes: string | null; clientId: string; clientName: string | null };
  type ReceiptRow = RowWithId & { receiptNumber: string; status: string; clientName: string | null };
  type TaskRow = RowWithId & { folio: string; title: string; status: string; notes: string | null; clientName: string | null };
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

  const [clients, policies, receipts, tasks, claims, quotes, insurers, documents] = await Promise.all([
    rawSearch<ClientRow>(
      "Client",
      ["id", "fullName", "email", "phone", "rfc", "address", "notes", "updatedAt"],
      ["fullName", "email", "phone", "rfc", "address", "notes"],
      needle,
    ),
    rawSearch<PolicyRow>(
      "Policy",
      ["id", "policyNumber", "policyType", "insuredObject", "notes", "clientId", "updatedAt"],
      ["policyNumber", "insuredObject", "notes"],
      needle,
      5,
      `, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Policy"."clientId") AS "clientName"`,
    ),
    rawSearch<ReceiptRow>(
      "Receipt",
      ["id", "receiptNumber", "status", "updatedAt"],
      ["receiptNumber"],
      needle,
      5,
      `, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Receipt"."clientId") AS "clientName"`,
    ),
    rawSearch<TaskRow>(
      "Task",
      ["id", "folio", "title", "status", "notes", "updatedAt"],
      ["folio", "title", "notes"],
      needle,
      5,
      `, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Task"."clientId") AS "clientName"`,
    ),
    rawSearch<ClaimRow>(
      "Claim",
      ["id", "folio", "claimType", "notes", "updatedAt"],
      ["folio", "claimType", "notes"],
      needle,
      5,
      `, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Claim"."clientId") AS "clientName"`,
    ),
    rawSearch<QuoteRow>(
      "Quote",
      ["id", "policyType", "notes", "updatedAt"],
      ["id", "notes"],
      needle,
      5,
      `, (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Quote"."clientId") AS "clientName"`,
    ),
    rawSearch<InsurerRow>(
      "Insurer",
      ["id", "name", "contactName", "notes", "updatedAt"],
      ["name", "contactName", "notes"],
      needle,
    ),
    rawSearch<DocumentRow>(
      "Document",
      ["id", "fileName", "documentType", "notes", "clientId", "policyId", "claimId", "receiptId", "taskId", "quoteId", "updatedAt"],
      ["fileName", "notes"],
      needle,
      5,
      `, COALESCE(
          (SELECT "fullName" FROM "Client" WHERE "Client"."id" = "Document"."clientId"),
          (SELECT "policyNumber" FROM "Policy" WHERE "Policy"."id" = "Document"."policyId"),
          (SELECT "folio" FROM "Claim" WHERE "Claim"."id" = "Document"."claimId"),
          (SELECT "receiptNumber" FROM "Receipt" WHERE "Receipt"."id" = "Document"."receiptId")
        ) AS "parentLabel"`,
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
    const match = pickMatch(p, ["policyNumber", "insuredObject", "notes"], needle);
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

  for (const t of tasks) {
    const match = pickMatch(t, ["folio", "title", "notes"], needle);
    results.push({
      id: t.id,
      type: "task",
      title: t.title,
      subtitle: `${t.clientName ?? "Sin cliente"} · ${t.status}`,
      href: `/tasks/${t.id}`,
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
