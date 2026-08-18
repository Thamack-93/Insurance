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

export function requiresInternalKnowledgeEvidence(question: string) {
  const normalized = question.toLocaleLowerCase("es-MX").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return CONTRACTUAL_TERMS.some((term) => normalized.includes(term.normalize("NFD").replace(/\p{Diacritic}/gu, "")));
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
  const paragraphs = content.replace(/\r/g, "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
    if (!current) {
      current = paragraph;
    } else if ((current.length + paragraph.length + 2) <= maxCharacters) {
      current = `${current}\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxCharacters) return [chunk];
    const parts: string[] = [];
    for (let index = 0; index < chunk.length; index += maxCharacters) parts.push(chunk.slice(index, index + maxCharacters));
    return parts;
  });
}

export async function createInternalKnowledgeSource(input: {
  context: OrganizationContext;
  title: string;
  insurerName?: string | null;
  product?: string | null;
  version: string;
  content: string;
  status?: KnowledgeSourceStatus;
}) {
  const title = cleanText(input.title, 200);
  const version = cleanText(input.version, 80);
  const content = input.content.replace(/\u0000/g, "").trim();
  const chunks = splitKnowledgeContent(content);
  if (!title || !version || !chunks.length) throw new Error("La fuente requiere título, versión y contenido.");
  if (!isKnowledgeContentSafe(content)) throw new Error("La base de conocimiento no admite contenido médico o clínico.");
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
        contentHash,
        createdById: input.context.userId,
        chunks: {
          create: chunks.map((chunk, ordinal) => ({
            organizationId: input.context.organizationId,
            ordinal,
            content: chunk,
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
  status?: KnowledgeSourceStatus;
}) {
  const title = cleanText(input.title, 200);
  const version = cleanText(input.version, 80);
  const content = input.content.replace(/\u0000/g, "").trim();
  const chunks = splitKnowledgeContent(content);
  if (!title || !version || !chunks.length) throw new Error("La fuente general requiere título, versión y contenido.");
  const contentHash = hashKnowledgeContent(`${title}\n${version}\n${content}`);
  const db = getDb();
  return db.$transaction(async (tx) => {
    const source = await tx.generalKnowledgeSource.upsert({
      where: { contentHash },
      update: { title, product: input.product ? cleanText(input.product, 120) : null, version, status: input.status ?? "ACTIVE" },
      create: { title, product: input.product ? cleanText(input.product, 120) : null, version, status: input.status ?? "ACTIVE", contentHash, chunks: { create: chunks.map((chunk, ordinal) => ({ ordinal, content: chunk })) } },
      select: { id: true, title: true, version: true, status: true },
    });
    const existingChunks = await tx.generalKnowledgeChunk.count({ where: { sourceId: source.id } });
    if (!existingChunks) await tx.generalKnowledgeChunk.createMany({ data: chunks.map((chunk, ordinal) => ({ sourceId: source.id, ordinal, content: chunk })) });
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
    select: { id: true, title: true, insurerName: true, product: true, version: true, status: true, effectiveFrom: true, effectiveTo: true, createdAt: true, _count: { select: { chunks: true } } },
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
  insurerName: string | null;
  product: string | null;
  page: number | null;
  section: string | null;
  content: string;
  rank: number;
};

function activeSourcePredicate() {
  return Prisma.sql`s."status" = 'ACTIVE' AND (s."effectiveFrom" IS NULL OR s."effectiveFrom" <= CURRENT_TIMESTAMP) AND (s."effectiveTo" IS NULL OR s."effectiveTo" >= CURRENT_TIMESTAMP)`;
}

async function searchInternal(input: { organizationId: string; question: string; insurerName?: string | null; product?: string | null; limit: number }) {
  const db = getDb();
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", s."id" AS "sourceId", s."title", s."version", s."insurerName", s."product", c."page", c."section", c."content",
      ts_rank(to_tsvector('simple', c."content"), websearch_to_tsquery('simple', ${input.question})) AS "rank"
    FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."organizationId" = ${input.organizationId} AND s."organizationId" = ${input.organizationId}
      AND ${activeSourcePredicate()}
      AND (${input.insurerName ?? null}::text IS NULL OR lower(s."insurerName") = lower(${input.insurerName ?? null}))
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', ${input.question})
    ORDER BY "rank" DESC, c."ordinal" ASC
    LIMIT ${input.limit}
  `);
}

async function searchGeneral(input: { question: string; product?: string | null; limit: number }) {
  const db = getDb();
  return db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT c."id" AS "chunkId", s."id" AS "sourceId", s."title", s."version", NULL::text AS "insurerName", s."product", c."page", c."section", c."content",
      ts_rank(to_tsvector('simple', c."content"), websearch_to_tsquery('simple', ${input.question})) AS "rank"
    FROM "GeneralKnowledgeChunk" c JOIN "GeneralKnowledgeSource" s ON s."id" = c."sourceId"
    WHERE ${activeSourcePredicate()}
      AND (${input.product ?? null}::text IS NULL OR lower(s."product") = lower(${input.product ?? null}))
      AND to_tsvector('simple', c."content") @@ websearch_to_tsquery('simple', ${input.question})
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
  limit?: number;
}) {
  const question = cleanText(input.question, 500);
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 5);
  if (!input.organizationId || question.length < 2) return { results: [], requiresInternalEvidence: false, abstained: true };
  const contractual = requiresInternalKnowledgeEvidence(question);
  const requested = input.sourceType ?? "BOTH";
  const internalRows = requested !== "GENERAL"
    ? await searchInternal({ organizationId: input.organizationId, question, insurerName: input.insurerName, product: input.product, limit })
    : [];
  if (internalRows.length || contractual || requested === "INTERNAL") {
    return { results: internalRows.map((row) => toResult(row, "INTERNAL")), requiresInternalEvidence: contractual, abstained: internalRows.length === 0 };
  }
  const generalRows = await searchGeneral({ question, product: input.product, limit });
  return { results: generalRows.map((row) => toResult(row, "GENERAL")), requiresInternalEvidence: contractual, abstained: generalRows.length === 0 };
}
