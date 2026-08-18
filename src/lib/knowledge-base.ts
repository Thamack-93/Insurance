import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { evaluateGmmPrivacy } from "@/lib/assistant-guardrails";
import {
  assertOrganizationContextInTransaction,
  type OrganizationContext,
} from "@/lib/organization-context";

export type KnowledgeSourceType = "INTERNAL" | "GENERAL";
export type KnowledgeSourceFilter = KnowledgeSourceType | "BOTH";
export type KnowledgeSourceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type KnowledgeCitation = {
  sourceId: string;
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

const KNOWLEDGE_QUERY_STOPWORDS = new Set([
  "a", "al", "como", "cómo", "con", "cual", "cuál", "de", "del", "el", "en", "es", "la", "las", "lo", "los",
  "para", "por", "que", "qué", "se", "sobre", "son", "su", "sus", "un", "una", "unas", "uno", "unos",
  "define", "defineme", "defíname", "explica", "significa", "seguro", "seguros", "mi", "mis", "esta", "este", "tu", "tus",
]);

export function requiresInternalKnowledgeEvidence(question: string) {
  const normalized = question.toLocaleLowerCase("es-MX").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const isGeneralDefinition = GENERAL_DEFINITION_PATTERNS.some((pattern) => pattern.test(normalized));
  const refersToConcretePolicy = CONCRETE_POLICY_CONTEXT.some((term) => normalized.includes(term.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
  if (isGeneralDefinition && !refersToConcretePolicy) return false;
  return CONTRACTUAL_TERMS.some((term) => normalized.includes(term.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
}

export function buildKnowledgeSearchQuery(question: string) {
  const normalized = question
    .toLocaleLowerCase("es-MX")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
  const terms = normalized.split(/\s+/).filter((term) => term.length > 2 && !KNOWLEDGE_QUERY_STOPWORDS.has(term));
  return terms.join(" ") || normalized.trim();
}

export function isKnowledgeContentSafe(content: string) {
  return !evaluateGmmPrivacy(content, false).hasSensitiveNarrative;
}

function cleanText(value: string, max: number) {
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function hashKnowledgeContent(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function splitKnowledgeContent(content: string, maxCharacters = 1_200) {
  return splitKnowledgeChunks(content, maxCharacters).map((chunk) => chunk.content);
}

type KnowledgeChunkInput = {
  content: string;
  section: string | null;
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
      parts.push({ content: chunk.content.slice(index, index + maxCharacters), section: chunk.section });
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
  const db = getDb();
  return db.$transaction(async (tx) => {
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
          })),
        },
      },
      select: { id: true, title: true, version: true, status: true },
    });
    return source;
  });
}

export async function seedGeneralKnowledgeSource(input: {
  title: string;
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
  if (!title || !version || !chunks.length) throw new Error("La fuente general requiere título, versión y contenido.");
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error("La vigencia final no puede ser anterior a la inicial.");
  const contentHash = hashKnowledgeContent(`${title}\n${version}\n${content}`);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const source = await tx.generalKnowledgeSource.upsert({
      where: { contentHash },
      update: {
        title,
        product: input.product ? cleanText(input.product, 120) : null,
        version,
        status: input.status ?? "ACTIVE",
        sourceUrl: cleanUrl(input.sourceUrl),
        authority: input.authority ? cleanText(input.authority, 120) : null,
        reviewedAt: cleanDate(input.reviewedAt),
        effectiveFrom: cleanDate(input.effectiveFrom),
        effectiveTo: cleanDate(input.effectiveTo),
      },
      create: {
        title,
        product: input.product ? cleanText(input.product, 120) : null,
        version,
        status: input.status ?? "ACTIVE",
        sourceUrl: cleanUrl(input.sourceUrl),
        authority: input.authority ? cleanText(input.authority, 120) : null,
        reviewedAt: cleanDate(input.reviewedAt),
        effectiveFrom: cleanDate(input.effectiveFrom),
        effectiveTo: cleanDate(input.effectiveTo),
        contentHash,
        chunks: { create: chunks.map((chunk, ordinal) => ({ ordinal, content: chunk.content, section: chunk.section })) },
      },
      select: { id: true, title: true, version: true, status: true },
    });
    const existingChunks = await tx.generalKnowledgeChunk.count({ where: { sourceId: source.id } });
    if (!existingChunks) await tx.generalKnowledgeChunk.createMany({ data: chunks.map((chunk, ordinal) => ({ sourceId: source.id, ordinal, content: chunk.content, section: chunk.section })) });
    if (source.status === "ACTIVE") {
      await tx.generalKnowledgeSource.updateMany({
        where: { status: "ACTIVE", product: input.product ? cleanText(input.product, 120) : null, id: { not: source.id } },
        data: { status: "ARCHIVED" },
      });
    }
    return source;
  });
}

export async function listInternalKnowledgeSources(organizationId: string) {
  if (!organizationId) return [];
  const db = getDb();
  return db.knowledgeSource.findMany({
    where: { organizationId },
    select: { id: true, title: true, insurerName: true, product: true, version: true, status: true, sourceUrl: true, authority: true, reviewedAt: true, effectiveFrom: true, effectiveTo: true, createdAt: true, _count: { select: { chunks: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

export async function activateInternalKnowledgeSource(context: OrganizationContext, sourceId: string) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const source = await tx.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: context.organizationId }, select: { id: true, insurerName: true, product: true } });
    if (!source) throw new Error("Fuente no encontrada en la organización activa.");
    await tx.knowledgeSource.updateMany({
      where: { organizationId: context.organizationId, status: "ACTIVE", insurerName: source.insurerName, product: source.product },
      data: { status: "ARCHIVED" },
    });
    return tx.knowledgeSource.update({ where: { id: source.id }, data: { status: "ACTIVE" }, select: { id: true, status: true } });
  });
}

export async function archiveInternalKnowledgeSource(context: OrganizationContext, sourceId: string) {
  const db = getDb();
  return db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const result = await tx.knowledgeSource.updateMany({ where: { id: sourceId, organizationId: context.organizationId }, data: { status: "ARCHIVED" } });
    if (!result.count) throw new Error("Fuente no encontrada en la organización activa.");
    return result;
  });
}

type SearchRow = {
  chunkId: string;
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

function sourceVisibilityPredicate(includeDraft: boolean) {
  if (includeDraft) return Prisma.sql`s."status" IN ('DRAFT', 'ACTIVE')`;
  return Prisma.sql`s."status" = 'ACTIVE' AND (s."effectiveFrom" IS NULL OR s."effectiveFrom" <= CURRENT_TIMESTAMP) AND (s."effectiveTo" IS NULL OR s."effectiveTo" >= CURRENT_TIMESTAMP)`;
}

async function searchInternal(input: { organizationId: string; question: string; insurerName?: string | null; product?: string | null; sourceId?: string | null; limit: number; includeDraft?: boolean }) {
  const db = getDb();
  const searchQuery = buildKnowledgeSearchQuery(input.question);
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", s."insurerName", s."product", c."page", c."section", c."content",
      ts_rank(to_tsvector('simple', c."content"), websearch_to_tsquery('simple', ${searchQuery})) AS "rank"
    FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."organizationId" = ${input.organizationId} AND s."organizationId" = ${input.organizationId}
      AND ${sourceVisibilityPredicate(input.includeDraft === true)}
      AND (${input.insurerName ?? null}::text IS NULL OR lower(s."insurerName") = lower(${input.insurerName ?? null}))
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND (${input.sourceId ?? null}::text IS NULL OR s."id" = ${input.sourceId ?? null})
      AND to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', ${searchQuery})
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${input.limit}
  `);
}

async function searchGeneral(input: { question: string; product?: string | null; limit: number }) {
  const db = getDb();
  const searchQuery = buildKnowledgeSearchQuery(input.question);
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", s."id" AS "sourceId", s."title", s."version", s."sourceUrl", s."authority", s."reviewedAt", NULL::text AS "insurerName", s."product", c."page", c."section", c."content",
      ts_rank(to_tsvector('simple', c."content"), websearch_to_tsquery('simple', ${searchQuery})) AS "rank"
    FROM "GeneralKnowledgeChunk" c JOIN "GeneralKnowledgeSource" s ON s."id" = c."sourceId"
    WHERE ${sourceVisibilityPredicate(false)}
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', ${searchQuery})
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${input.limit}
  `);
}

function toResult(row: SearchRow, sourceType: KnowledgeSourceType): KnowledgeSearchResult {
  return {
    sourceId: row.sourceId,
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

export async function searchKnowledgeBase(input: {
  organizationId: string;
  question: string;
  sourceType?: KnowledgeSourceFilter;
  insurerName?: string | null;
  product?: string | null;
  sourceId?: string | null;
  includeDraft?: boolean;
  limit?: number;
}) {
  const question = cleanText(input.question, 500);
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 5);
  if (!input.organizationId || question.length < 2) return { results: [], requiresInternalEvidence: false, abstained: true };
  const contractual = requiresInternalKnowledgeEvidence(question);
  const requested = input.sourceType ?? "BOTH";
  const internalRows = requested !== "GENERAL"
    ? await searchInternal({ organizationId: input.organizationId, question, insurerName: input.insurerName, product: input.product, sourceId: input.sourceId, limit, includeDraft: input.includeDraft })
    : [];
  if (internalRows.length || contractual || requested === "INTERNAL") {
    return { results: internalRows.map((row) => toResult(row, "INTERNAL")), requiresInternalEvidence: contractual, abstained: internalRows.length === 0 };
  }
  const generalRows = await searchGeneral({ question, product: input.product, limit });
  return { results: generalRows.map((row) => toResult(row, "GENERAL")), requiresInternalEvidence: contractual, abstained: generalRows.length === 0 };
}
