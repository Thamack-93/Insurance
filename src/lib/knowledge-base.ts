import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getBusinessDateKey, BUSINESS_TIME_ZONE } from "@/lib/business-dates";
import { hashKnowledgeContent, hashKnowledgeManifest, KNOWLEDGE_INTEGRITY_VERSION } from "@/lib/knowledge-integrity";
import {
  assertOrganizationContextInTransaction,
  requireOrganizationContext,
  withTenantTransaction,
  type TenantDb,
  type OrganizationContext,
} from "@/lib/organization-context";

export type KnowledgeSourceType = "INTERNAL" | "GENERAL";
export type KnowledgeSourceFilter = KnowledgeSourceType | "BOTH";
export type KnowledgeSourceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export { hashKnowledgeContent, hashKnowledgeManifest, KNOWLEDGE_INTEGRITY_VERSION } from "@/lib/knowledge-integrity";

export type KnowledgeAbstentionReason =
  | "NO_ACTIVE_SOURCE"
  | "OUT_OF_VALIDITY"
  | "INTEGRITY_FAILED"
  | "NO_RELEVANT_EVIDENCE"
  | "INTERNAL_EVIDENCE_REQUIRED"
  | "PRIVACY_BLOCKED"
  | "SEARCH_ERROR";

export type KnowledgeCitation = {
  sourceId: string;
  chunkId: string;
  chunkOrdinal: number;
  sourceType: KnowledgeSourceType;
  title: string;
  version: string;
  sourceUrl: string | null;
  authority: string | null;
  reviewedAt: string | null;
  page: number | null;
  section: string | null;
  match: number;
};

export type KnowledgeSearchResult = KnowledgeCitation & {
  excerpt: string;
  insurerName?: string | null;
  product?: string | null;
};

export type KnowledgeSearchResponse = {
  results: KnowledgeSearchResult[];
  requiresInternalEvidence: boolean;
  abstained: boolean;
  abstentionReason?: KnowledgeAbstentionReason;
  executedQuery: string;
  selectedSourceIds: string[];
  citationCount: number;
  durationMs: number;
};

function redactKnowledgeQuery(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[correo]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/gu, "[teléfono]")
    .replace(/\b\d{6,}\b/gu, "[identificador]")
    .slice(0, 300);
}

const CONTRACTUAL_TERMS = [
  "cobertura", "cubre", "ampara", "exclusion", "exclusión", "condiciones", "clausula", "cláusula",
  "indemnizacion", "indemnización", "responsabilidad", "deducible", "limite", "límite", "vigencia",
  "contrato", "poliza", "póliza", "procedencia",
];

const GENERAL_DEFINITION_PATTERNS = [
  /^(?:¿\s*)?que\s+(?:es|son|significa)\b/u,
  /^(?:¿\s*)?(?:define|explica)\b/u,
];

const CONCRETE_POLICY_CONTEXT = [
  " mi ", " mis ", " esta ", " este ", " tu ", " tus ", " la poliza ", " la póliza ", " el contrato ",
];

const POLICY_IDENTIFIER_PATTERN = /\b(?:p[oó]liza|policy)\s*(?:n[uú]mero|no\.?|#)?\s*#?\s*[A-Z0-9]*\d[A-Z0-9/-]{2,}\b/iu;

const KNOWLEDGE_QUERY_STOPWORDS = new Set([
  "a", "al", "como", "cómo", "con", "cual", "cuál", "de", "del", "el", "en", "es", "la", "las", "lo", "los",
  "para", "por", "que", "qué", "se", "sobre", "son", "su", "sus", "un", "una", "unas", "uno", "unos",
  "define", "defineme", "defíname", "explica", "significa", "seguro", "seguros", "mi", "mis", "esta", "este", "tu", "tus",
  "definicion", "definiciones", "general", "generales", "concepto", "conceptos", "basico", "basica", "basicos", "basicas",
  "suele", "suelen", "usual", "usuales", "frecuente", "frecuentes", "despues", "después", "siguiente", "siguientes", "siguen",
  "hacer", "necesito", "necesitas", "generar", "solicitar", "solicita", "programar", "programacion", "programación",
]);

const KNOWLEDGE_TERM_ALIASES = new Map([
  ["auto", "auto"],
  ["automovil", "auto"],
  ["automoviles", "auto"],
  ["cubrir", "cobertura"],
  ["cubre", "cobertura"],
  ["coberturas", "cobertura"],
  ["operativos", "operativo"],
  ["operativas", "operativo"],
  ["pasos", "paso"],
  ["reportar", "reporte"],
  ["reportado", "reporte"],
  ["reportada", "reporte"],
  ["hospitalizado", "hospitalizacion"],
  ["hospitalizados", "hospitalizacion"],
  ["hospitalizacion", "hospitalizacion"],
  ["hospitalizaciones", "hospitalizacion"],
  ["cirugias", "cirugia"],
  ["reembolsos", "reembolso"],
  ["requisitos", "requisito"],
  ["faltantes", "faltante"],
]);

const KNOWLEDGE_TERM_VARIANTS = new Map([
  ["cobertura", ["cobertura", "coberturas"]],
  ["operativo", ["operativo", "operativa", "operativos", "operativas"]],
  ["paso", ["paso", "pasos"]],
  ["reporte", ["reporte", "reportar", "reportado", "reportada"]],
  ["hospitalizacion", ["hospitalizacion", "hospitalización"]],
  ["cirugia", ["cirugia", "cirugía"]],
  ["reembolso", ["reembolso", "reembolsos"]],
  ["auto", ["auto", "automovil", "automóvil"]],
  ["poliza", ["poliza", "póliza", "polizas", "pólizas"]],
]);

export function requiresInternalKnowledgeEvidence(question: string) {
  const normalized = question.toLocaleLowerCase("es-MX").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const isGeneralDefinition = GENERAL_DEFINITION_PATTERNS.some((pattern) => pattern.test(normalized));
  const refersToConcretePolicy = CONCRETE_POLICY_CONTEXT.some((term) => normalized.includes(term.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
  if (isGeneralDefinition && !refersToConcretePolicy) return false;
  return CONTRACTUAL_TERMS.some((term) => normalized.includes(term.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
}

/**
 * Concrete policy questions need a policy identifier before Nora can look up
 * tenant evidence. This is a clarification state, not a factual answer, so it
 * must happen before the KB search/abstention path.
 */
export function requiresPolicyIdentifier(question: string) {
  const normalized = ` ${question
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")} `;
  const hasConcreteContext = CONCRETE_POLICY_CONTEXT.some((term) => {
    const normalizedTerm = term.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
    return normalized.includes(` ${normalizedTerm} `);
  });
  const asksForApplication = /\baplic(?:a|ar|an|able)\b/u.test(normalized);
  return requiresInternalKnowledgeEvidence(question) && (hasConcreteContext || asksForApplication) && !POLICY_IDENTIFIER_PATTERN.test(question);
}

export function hasExplicitPolicyIdentifier(question: string) {
  return POLICY_IDENTIFIER_PATTERN.test(question);
}

export function buildKnowledgeSearchQuery(question: string) {
  const normalized = question
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  const terms = normalized
    .split(/\s+/)
    .filter((term) => term.length > 2 && !KNOWLEDGE_QUERY_STOPWORDS.has(term))
    .map((term) => KNOWLEDGE_TERM_ALIASES.get(term) ?? term);
  return terms.join(" ") || normalized.trim();
}

export function buildKnowledgeFallbackQuery(question: string) {
  const terms = [...new Set(buildKnowledgeSearchQuery(question).split(/\s+/).filter(Boolean))];
  return terms
    .flatMap((term) => KNOWLEDGE_TERM_VARIANTS.get(term) ?? [term])
    .filter((term, index, all) => all.indexOf(term) === index)
    .map((term) => `${term}:*`)
    .join(" | ");
}

export function isKnowledgeContentSafe(content: string) {
  const sensitiveKnowledgePatterns = [
    /\bdiagn[oó]stic/iu,
    /\bs[ií]ntom/iu,
    /\bpadec/iu,
    /\btratamiento/iu,
    /\bmedicamento/iu,
    /\bnota\s+cl[ií]nica/iu,
    /\b(?:resultado|estudio)\s+(?:cl[ií]nico|m[eé]dico|de\s+laboratorio)/iu,
    /\b(?:dr|dra)\.?\s+[\p{L}]/iu,
    /\b(?:factura|comprobante)\s+m[eé]dic/iu,
    /\b[\w-]+\.(?:pdf|jpe?g|png|docx?)\b/iu,
    /\b(?:ocr|expediente\s+cl[ií]nico|archivo\s+cl[ií]nico)/iu,
  ];
  return !sensitiveKnowledgePatterns.some((pattern) => pattern.test(content));
}

function cleanText(value: string, max: number) {
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export type { KnowledgeManifestChunk } from "@/lib/knowledge-integrity";

export function splitKnowledgeContent(content: string, maxCharacters = 1_200) {
  return splitKnowledgeChunks(content, maxCharacters).map((chunk) => chunk.content);
}

type KnowledgeChunkInput = {
  content: string;
  section: string | null;
  page?: number | null;
};

export function splitKnowledgeChunks(content: string, maxCharacters = 1_200): KnowledgeChunkInput[] {
  const paragraphs = content.replace(/\r/g, "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: KnowledgeChunkInput[] = [];
  let current = "";
  let section: string | null = null;
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
    const firstLine = paragraph.split("\n", 1)[0]?.trim() ?? "";
    if (/^#{1,6}\s+/.test(firstLine)) section = firstLine.replace(/^#{1,6}\s+/, "").trim() || section;
    if (!current) {
      current = paragraph;
    } else if ((current.length + paragraph.length + 2) <= maxCharacters) {
      current = `${current}\n\n${paragraph}`;
    } else {
      chunks.push({ content: current, section });
      current = paragraph;
    }
  }
  if (current) chunks.push({ content: current, section });
  return chunks.flatMap((chunk) => {
    if (chunk.content.length <= maxCharacters) return [chunk];
    const parts: KnowledgeChunkInput[] = [];
    for (let index = 0; index < chunk.content.length; index += maxCharacters) {
      parts.push({ content: chunk.content.slice(index, index + maxCharacters), section: chunk.section, page: null });
    }
    return parts;
  });
}

function cleanUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString().slice(0, 500);
  } catch {
    throw new Error("La fuente debe usar una URL https válida.");
  }
}

function cleanDate(value: Date | null | undefined) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

export async function createInternalKnowledgeSource(input: {
  context: OrganizationContext;
  title: string;
  insurerName?: string | null;
  product?: string | null;
  version: string;
  content: string;
  sourceUrl?: string | null;
  authority?: string | null;
  reviewedAt?: Date | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  status?: KnowledgeSourceStatus;
}) {
  const title = cleanText(input.title, 200);
  const version = cleanText(input.version, 80);
  const content = input.content.replace(/\u0000/g, "").trim();
  const chunks = splitKnowledgeChunks(content);
  if (!title || !version || !chunks.length) throw new Error("La fuente requiere título, versión y contenido.");
  if (!isKnowledgeContentSafe(content)) throw new Error("La base de conocimiento no admite contenido médico o clínico.");
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error("La vigencia final no puede ser anterior a la inicial.");
  const contentHash = hashKnowledgeContent(`${title}\n${version}\n${content}`);
  const manifestHash = hashKnowledgeManifest(title, version, chunks.map((chunk, ordinal) => ({ ...chunk, ordinal, page: chunk.page ?? null })));
  return withTenantTransaction(input.context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, input.context, ["OWNER", "ADMIN"]);
    const source = await tx.knowledgeSource.create({
      data: {
        organizationId: input.context.organizationId,
        title,
        insurerName: input.insurerName ? cleanText(input.insurerName, 160) : null,
        product: input.product ? cleanText(input.product, 120) : null,
        version,
        status: input.status ?? "DRAFT",
        sourceUrl: cleanUrl(input.sourceUrl),
        authority: input.authority ? cleanText(input.authority, 120) : null,
        reviewedAt: cleanDate(input.reviewedAt),
        effectiveFrom: cleanDate(input.effectiveFrom),
        effectiveTo: cleanDate(input.effectiveTo),
        contentHash,
        createdById: input.context.userId,
        chunks: {
          create: chunks.map((chunk, ordinal) => ({
            organizationId: input.context.organizationId,
            ordinal,
            content: chunk.content,
            section: chunk.section,
            page: chunk.page ?? null,
          })),
        },
      },
      select: { id: true, title: true, version: true, status: true },
    });
    return tx.knowledgeSource.update({
      where: { id: source.id },
      data: { status: input.status ?? "DRAFT", manifestHash, integrityVersion: KNOWLEDGE_INTEGRITY_VERSION, integrityVerifiedAt: new Date() },
      select: { id: true, title: true, version: true, status: true },
    });
  });
}

export async function listInternalKnowledgeSources(organizationId: string) {
  if (!organizationId) return [];
  const context = await requireOrganizationContext();
  if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, (db) => db.knowledgeSource.findMany({
    where: { organizationId },
    select: { id: true, title: true, insurerName: true, product: true, version: true, status: true, sourceUrl: true, authority: true, reviewedAt: true, effectiveFrom: true, effectiveTo: true, manifestHash: true, integrityVersion: true, integrityVerifiedAt: true, createdAt: true, updatedAt: true, _count: { select: { chunks: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  }));
}

export async function listGeneralKnowledgeSources() {
  // General knowledge is platform-global and intentionally outside the tenant
  // transaction; protected KnowledgeSource/KnowledgeChunk access is always
  // handled by the tenant DAL below.
  const db = (await import("@/lib/db")).getDb();
  return db.generalKnowledgeSource.findMany({
    select: { id: true, title: true, product: true, version: true, status: true, sourceUrl: true, authority: true, reviewedAt: true, effectiveFrom: true, effectiveTo: true, manifestHash: true, integrityVersion: true, integrityVerifiedAt: true, createdAt: true, updatedAt: true, _count: { select: { chunks: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

export async function activateInternalKnowledgeSource(context: OrganizationContext, sourceId: string) {
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const source = await tx.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: context.organizationId }, include: { chunks: { orderBy: { ordinal: "asc" }, select: { ordinal: true, content: true, section: true, page: true } } } });
    if (!source) throw new Error("Fuente no encontrada en la organización activa.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.organizationId}:${source.insurerName ?? ""}:${source.product ?? ""}`}, 0))`;
    const manifestHash = hashKnowledgeManifest(source.title, source.version, source.chunks);
    await tx.knowledgeSource.updateMany({
      where: { organizationId: context.organizationId, status: "ACTIVE", insurerName: source.insurerName, product: source.product },
      data: { status: "ARCHIVED" },
    });
    return tx.knowledgeSource.update({ where: { id: source.id }, data: { status: "ACTIVE", manifestHash, integrityVersion: KNOWLEDGE_INTEGRITY_VERSION, integrityVerifiedAt: new Date() }, select: { id: true, status: true, manifestHash: true, integrityVerifiedAt: true } });
  });
}

export async function archiveInternalKnowledgeSource(context: OrganizationContext, sourceId: string) {
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const result = await tx.knowledgeSource.updateMany({ where: { id: sourceId, organizationId: context.organizationId }, data: { status: "ARCHIVED" } });
    if (!result.count) throw new Error("Fuente no encontrada en la organización activa.");
    return result;
  });
}

type SearchRow = {
  chunkId: string;
  chunkOrdinal: number;
  sourceId: string;
  title: string;
  version: string;
  sourceUrl: string | null;
  authority: string | null;
  reviewedAt: Date | null;
  insurerName: string | null;
  product: string | null;
  page: number | null;
  section: string | null;
  content: string;
  rank: number;
};

/** Frozen after the deterministic 32-case fixture calibration (CHUNK_MANIFEST_V1). */
export const KNOWLEDGE_RETRIEVAL_THRESHOLD_VERSION = "knowledge-fixture-32-v1";
export const KNOWLEDGE_RETRIEVAL_THRESHOLD = 0.05;

function sourceVisibilityPredicate(input: { includeDraft: boolean; asOfDate: string }) {
  const lifecycle = input.includeDraft
    ? Prisma.sql`s."status" IN ('DRAFT', 'ACTIVE')`
    : Prisma.sql`s."status" = 'ACTIVE' AND (s."effectiveFrom" IS NULL OR s."effectiveFrom" <= ${input.asOfDate}::date) AND (s."effectiveTo" IS NULL OR s."effectiveTo" >= ${input.asOfDate}::date)`;
  return Prisma.sql`${lifecycle}
    AND length(btrim(s."version")) > 0
    AND s."integrityVersion" = ${KNOWLEDGE_INTEGRITY_VERSION}
    AND s."integrityVerifiedAt" IS NOT NULL
    AND s."manifestHash" ~ '^[0-9a-f]{64}$'`;
}

function rankVector(title: Prisma.Sql, section: Prisma.Sql, content: Prisma.Sql) {
  return Prisma.sql`(
    setweight(to_tsvector('policydesk_spanish', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('policydesk_spanish', coalesce(${section}, '')), 'B') ||
    setweight(to_tsvector('policydesk_spanish', coalesce(${content}, '')), 'D')
  )`;
}

function documentVector(section: Prisma.Sql, content: Prisma.Sql) {
  return Prisma.sql`(
    setweight(to_tsvector('policydesk_spanish', coalesce(${section}, '')), 'B') ||
    setweight(to_tsvector('policydesk_spanish', coalesce(${content}, '')), 'D')
  )`;
}

function textQuery(query: string) {
  return Prisma.sql`websearch_to_tsquery('policydesk_spanish', ${query})`;
}

async function searchInternal(input: { organizationId: string; question: string; insurerName?: string | null; product?: string | null; sourceId?: string | null; limit: number; includeDraft: boolean; asOfDate: string }, db: TenantDb) {
  const searchQuery = buildKnowledgeSearchQuery(input.question);
  const vector = rankVector(Prisma.sql`s."title"`, Prisma.sql`c."section"`, Prisma.sql`c."content"`);
  const document = documentVector(Prisma.sql`c."section"`, Prisma.sql`c."content"`);
  const exactRows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", c."ordinal" AS "chunkOrdinal", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", s."insurerName", s."product", c."page", c."section", c."content",
      ts_rank(${vector}, ${textQuery(searchQuery)}) AS "rank"
    FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."organizationId" = ${input.organizationId} AND s."organizationId" = ${input.organizationId}
      AND ${sourceVisibilityPredicate(input)}
      AND (${input.insurerName ?? null}::text IS NULL OR lower(s."insurerName") = lower(${input.insurerName ?? null}))
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND (${input.sourceId ?? null}::text IS NULL OR s."id" = ${input.sourceId ?? null})
      AND ${document} @@ ${textQuery(searchQuery)}
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${Math.min(input.limit * 3, 15)}
  `);
  if (exactRows.length) return exactRows;

  const fallbackQuery = buildKnowledgeFallbackQuery(input.question);
  if (!fallbackQuery) return exactRows;
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", c."ordinal" AS "chunkOrdinal", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", s."insurerName", s."product", c."page", c."section", c."content",
      ts_rank(${vector}, to_tsquery('policydesk_spanish', ${fallbackQuery})) AS "rank"
    FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."organizationId" = ${input.organizationId} AND s."organizationId" = ${input.organizationId}
      AND ${sourceVisibilityPredicate(input)}
      AND (${input.insurerName ?? null}::text IS NULL OR lower(s."insurerName") = lower(${input.insurerName ?? null}))
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND (${input.sourceId ?? null}::text IS NULL OR s."id" = ${input.sourceId ?? null})
      AND ${document} @@ to_tsquery('policydesk_spanish', ${fallbackQuery})
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${Math.min(input.limit * 3, 15)}
  `);
}

async function searchGeneral(input: { question: string; product?: string | null; limit: number; asOfDate: string }, db: TenantDb) {
  const searchQuery = buildKnowledgeSearchQuery(input.question);
  const vector = rankVector(Prisma.sql`s."title"`, Prisma.sql`c."section"`, Prisma.sql`c."content"`);
  const document = documentVector(Prisma.sql`c."section"`, Prisma.sql`c."content"`);
  const exactRows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", c."ordinal" AS "chunkOrdinal", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", NULL::text AS "insurerName", s."product", c."page", c."section", c."content",
      ts_rank(${vector}, ${textQuery(searchQuery)}) AS "rank"
    FROM "GeneralKnowledgeChunk" c JOIN "GeneralKnowledgeSource" s ON s."id" = c."sourceId"
    WHERE ${sourceVisibilityPredicate({ includeDraft: false, asOfDate: input.asOfDate })}
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND ${document} @@ ${textQuery(searchQuery)}
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${Math.min(input.limit * 3, 15)}
  `);
  if (exactRows.length) return exactRows;

  const fallbackQuery = buildKnowledgeFallbackQuery(input.question);
  if (!fallbackQuery) return exactRows;
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", c."ordinal" AS "chunkOrdinal", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", NULL::text AS "insurerName", s."product", c."page", c."section", c."content",
      ts_rank(${vector}, to_tsquery('policydesk_spanish', ${fallbackQuery})) AS "rank"
    FROM "GeneralKnowledgeChunk" c JOIN "GeneralKnowledgeSource" s ON s."id" = c."sourceId"
    WHERE ${sourceVisibilityPredicate({ includeDraft: false, asOfDate: input.asOfDate })}
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND ${document} @@ to_tsquery('policydesk_spanish', ${fallbackQuery})
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${Math.min(input.limit * 3, 15)}
  `);
}

function toResult(row: SearchRow, sourceType: KnowledgeSourceType): KnowledgeSearchResult {
  return {
    sourceId: row.sourceId,
    chunkId: row.chunkId,
    chunkOrdinal: row.chunkOrdinal,
    sourceType,
    title: row.title,
    version: row.version,
    sourceUrl: row.sourceUrl,
    authority: row.authority,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    page: row.page,
    section: row.section,
    match: Number(row.rank ?? 0),
    excerpt: cleanText(row.content, 900),
    insurerName: row.insurerName,
    product: row.product,
  };
}

function queryTerms(question: string) {
  return [...new Set(buildKnowledgeSearchQuery(question).split(/\s+/).filter(Boolean))];
}

function hasSufficientCoverage(row: KnowledgeSearchResult, question: string) {
  if (row.match < KNOWLEDGE_RETRIEVAL_THRESHOLD) return false;
  const terms = queryTerms(question);
  if (terms.length <= 1) return true;
  const normalized = row.excerpt.toLocaleLowerCase("es-MX").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const matched = terms.filter((term) => normalized.includes(term)).length;
  return matched >= Math.ceil(terms.length / 2);
}

function deduplicateResults(results: KnowledgeSearchResult[], question: string, limit: number) {
  const seen = new Set<string>();
  return results
    .filter((result) => hasSufficientCoverage(result, question))
    .sort((left, right) => right.match - left.match || left.sourceType.localeCompare(right.sourceType) || left.sourceId.localeCompare(right.sourceId) || left.chunkOrdinal - right.chunkOrdinal)
    .filter((result) => {
      const key = `${result.sourceType}:${result.chunkId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

async function getKnowledgeAsOfDate(organizationId: string, db: TenantDb) {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true } });
  return getBusinessDateKey(new Date(), organization?.timeZone || BUSINESS_TIME_ZONE);
}

function responseFor(input: { startedAt: number; question: string; contractual: boolean; results: KnowledgeSearchResult[]; abstentionReason?: KnowledgeAbstentionReason }): KnowledgeSearchResponse {
  const results = input.results;
  return {
    results,
    requiresInternalEvidence: input.contractual,
    abstained: results.length === 0,
    ...(results.length === 0 ? { abstentionReason: input.abstentionReason ?? (input.contractual ? "INTERNAL_EVIDENCE_REQUIRED" : "NO_RELEVANT_EVIDENCE") } : {}),
    executedQuery: redactKnowledgeQuery(buildKnowledgeSearchQuery(input.question)),
    selectedSourceIds: [...new Set(results.map((result) => result.sourceId))],
    citationCount: results.length,
    durationMs: Date.now() - input.startedAt,
  };
}

export async function searchActiveKnowledgeBase(input: {
  organizationId: string;
  question: string;
  sourceType?: KnowledgeSourceFilter;
  insurerName?: string | null;
  product?: string | null;
  sourceId?: string | null;
  limit?: number;
  asOfDate?: string;
}): Promise<KnowledgeSearchResponse> {
  const startedAt = Date.now();
  const question = cleanText(input.question, 500);
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 5);
  if (!input.organizationId || question.length < 2) return responseFor({ startedAt, question, contractual: false, results: [], abstentionReason: "NO_RELEVANT_EVIDENCE" });
  const contractual = requiresInternalKnowledgeEvidence(question);
  const requested = input.sourceType ?? "BOTH";
  const context = await requireOrganizationContext();
  if (context.organizationId !== input.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  try {
    return await withTenantTransaction(context, async (db) => {
      const asOfDate = input.asOfDate ?? await getKnowledgeAsOfDate(input.organizationId, db);
      const internalPromise = requested !== "GENERAL"
        ? searchInternal({ organizationId: input.organizationId, question, insurerName: input.insurerName, product: input.product, sourceId: input.sourceId, limit, includeDraft: false, asOfDate }, db)
        : Promise.resolve([] as SearchRow[]);
      const generalPromise = !contractual && requested !== "INTERNAL"
        ? searchGeneral({ question, product: input.product, limit, asOfDate }, db)
        : Promise.resolve([] as SearchRow[]);
      const [internalRows, generalRows] = await Promise.all([internalPromise, generalPromise]);
      const results = deduplicateResults([
        ...internalRows.map((row) => toResult(row, "INTERNAL")),
        ...generalRows.map((row) => toResult(row, "GENERAL")),
      ], question, limit);
      return responseFor({ startedAt, question, contractual, results, abstentionReason: contractual ? "INTERNAL_EVIDENCE_REQUIRED" : "NO_RELEVANT_EVIDENCE" });
    });
  } catch {
    return responseFor({ startedAt, question, contractual, results: [], abstentionReason: "SEARCH_ERROR" });
  }
}

export async function previewInternalKnowledgeSource(input: {
  organizationId: string;
  sourceId?: string | null;
  question: string;
  limit?: number;
  asOfDate?: string;
}) {
  const startedAt = Date.now();
  const context = await requireOrganizationContext();
  if (context.organizationId !== input.organizationId || !["OWNER", "ADMIN"].includes(context.membershipRole)) {
    throw new Error("La previsualización de fuentes requiere permisos de administración en la organización activa.");
  }
  const question = cleanText(input.question, 500);
  return withTenantTransaction(context, async (db) => {
    const asOfDate = input.asOfDate ?? await getKnowledgeAsOfDate(input.organizationId, db);
    const rows = await searchInternal({ organizationId: input.organizationId, question, sourceId: input.sourceId, limit: Math.min(Math.max(input.limit ?? 5, 1), 5), includeDraft: true, asOfDate }, db);
    const results = deduplicateResults(rows.map((row) => toResult(row, "INTERNAL")), question, Math.min(Math.max(input.limit ?? 5, 1), 5));
    return responseFor({ startedAt, question, contractual: requiresInternalKnowledgeEvidence(question), results, abstentionReason: "NO_RELEVANT_EVIDENCE" });
  });
}

/** @deprecated Use searchActiveKnowledgeBase or previewInternalKnowledgeSource. */
export async function searchKnowledgeBase(input: Parameters<typeof searchActiveKnowledgeBase>[0]) {
  return searchActiveKnowledgeBase(input);
}
