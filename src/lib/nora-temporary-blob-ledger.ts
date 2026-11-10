import "server-only";

import { del } from "@vercel/blob";
import { Prisma } from "@/generated/prisma/client";
import type { OrganizationContext } from "@/lib/organization-context";
import { assertOrganizationContextInTransaction, withSystemOrganizationTransaction, withTenantTransaction } from "@/lib/organization-context";
import { getDb } from "@/lib/db";
import { isNoraCaptureHandoffPathnameForOrganization } from "@/lib/nora-capture-handoff-storage.shared";
import { isNoraPolicyPdfPathnameForOrganization } from "@/lib/nora-pdf-storage.shared";

export type NoraTemporaryBlobKind = "POLICY_PDF" | "CAPTURE_HANDOFF";

export async function registerNoraTemporaryBlob(input: {
  context: OrganizationContext;
  userId: string;
  pathname: string;
  kind: NoraTemporaryBlobKind;
  expiresAt: Date;
  uploadedAt?: Date | null;
}) {
  const { context } = input;
  await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    await tx.noraTemporaryBlob.upsert({
      where: { pathname: input.pathname },
      create: {
        organizationId: context.organizationId,
        userId: input.userId,
        pathname: input.pathname,
        kind: input.kind,
        uploadedAt: input.uploadedAt ?? null,
        expiresAt: input.expiresAt,
      },
      update: {
        organizationId: context.organizationId,
        userId: input.userId,
        kind: input.kind,
        uploadedAt: input.uploadedAt ?? null,
        expiresAt: input.expiresAt,
      },
    });
  });
}

export async function markNoraTemporaryBlobDeleted(input: {
  context: OrganizationContext;
  pathname: string;
  userId: string;
}) {
  await withTenantTransaction(input.context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, input.context);
    await tx.noraTemporaryBlob.deleteMany({
      where: {
        organizationId: input.context.organizationId,
        userId: input.userId,
        pathname: input.pathname,
      },
    });
  });
}

export async function recordCompletedNoraPolicyPdfUpload(input: {
  organizationId: string;
  userId: string;
  pathname: string;
  uploadedAt: Date;
  expiresAt: Date;
}) {
  if (!isNoraPolicyPdfPathnameForOrganization(input.pathname, input.organizationId)) return;
  await withSystemOrganizationTransaction(input.organizationId, "nora temporary blob lifecycle", (tx) => tx.noraTemporaryBlob.updateMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      pathname: input.pathname,
      kind: "POLICY_PDF",
    },
    data: { uploadedAt: input.uploadedAt, expiresAt: input.expiresAt },
  }));
}

function validLedgerPath(kind: string, pathname: string, organizationId: string) {
  if (kind === "POLICY_PDF") return isNoraPolicyPdfPathnameForOrganization(pathname, organizationId);
  if (kind === "CAPTURE_HANDOFF") return isNoraCaptureHandoffPathnameForOrganization(pathname, organizationId);
  return false;
}

export async function cleanupExpiredNoraTemporaryBlobs(now = new Date()) {
  const db = getDb();
  const organizations = await db.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let deleted = 0;
  let failed = 0;

  for (const organization of organizations) {
    let expired: Array<{ id: string; pathname: string; kind: string; expiresAt: Date }>;
    try {
      expired = await withSystemOrganizationTransaction(organization.id, "nora temporary blob retention", (tx) => tx.noraTemporaryBlob.findMany({
        where: { organizationId: organization.id, expiresAt: { lte: now } },
        select: { id: true, pathname: true, kind: true, expiresAt: true },
        orderBy: { expiresAt: "asc" },
        take: 200,
      }));
    } catch (error) {
      failed++;
      console.error("NORA_TEMP_BLOB_LEDGER_QUERY_FAILED", JSON.stringify({ organizationId: organization.id, message: error instanceof Error ? error.name : "unknown" }));
      continue;
    }

    for (const candidate of expired) {
      if (!validLedgerPath(candidate.kind, candidate.pathname, organization.id)) {
        failed++;
        console.error("NORA_TEMP_BLOB_LEDGER_PATH_REJECTED", JSON.stringify({ organizationId: organization.id, kind: candidate.kind }));
        continue;
      }

      try {
        const wasDeleted = await withSystemOrganizationTransaction(
          organization.id,
          "nora temporary blob retention",
          async (tx) => {
            const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id" FROM "NoraTemporaryBlob"
               WHERE "id" = ${candidate.id}
                 AND "organizationId" = ${organization.id}
                 AND "expiresAt" <= ${now}
               FOR UPDATE
            `);
            if (!locked[0]) return false;
            await del(candidate.pathname);
            await tx.noraTemporaryBlob.deleteMany({
              where: { id: candidate.id, organizationId: organization.id, expiresAt: { lte: now } },
            });
            return true;
          },
          { timeout: 30_000 },
        );
        if (wasDeleted) deleted++;
      } catch {
        failed++;
      }
    }

  }

  await db.blobOperationUsage.deleteMany({
    where: { periodStart: { lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 400 * 86_400_000) } },
  }).catch(() => undefined);
  return { deleted, failed, organizations: organizations.length };
}
