import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type AlertLinkDb = PrismaClient | Prisma.TransactionClient;

/**
 * Alertas y pendientes describen su sujeto con el par `entityType`/`entityId`,
 * que también admite sujetos que no son registros nuestros (SecurityEvent,
 * System). Para las entidades que el usuario sí puede borrar existe además una
 * columna tipada con llave foránea; esta función la resuelve.
 *
 * El registro se verifica antes de enlazar: si el identificador ya no existe,
 * la alerta se crea igual con su par `entityType`/`entityId` intacto en vez de
 * fallar por violación de integridad.
 */
export async function resolveAlertEntityLink(
  db: AlertLinkDb,
  organizationId: string,
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): Promise<{ clientId?: string; policyId?: string; receiptId?: string }> {
  if (!entityType || !entityId) return {};

  switch (entityType.toUpperCase()) {
    case "CLIENT": {
      const found = await db.client.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return found ? { clientId: found.id } : {};
    }
    case "POLICY": {
      const found = await db.policy.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return found ? { policyId: found.id } : {};
    }
    case "RECEIPT": {
      const found = await db.receipt.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
      return found ? { receiptId: found.id } : {};
    }
    default:
      return {};
  }
}
