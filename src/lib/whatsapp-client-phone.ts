import type { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { normalizeMexicanPhone } from "@/lib/phone";
import { selectWhatsAppPhone, type WhatsAppPhoneSelection } from "@/lib/whatsapp";

export type WhatsAppPhoneCaptureSource = "RECEIPT_REMINDER" | "RENEWAL_CONTACT";

export async function resolveClientWhatsAppPhone({
  tx,
  organizationId,
  userId,
  client,
  capturedPhone,
  source,
  sourceChannel,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
  client: { id: string; phone: string | null; secondaryPhone: string | null };
  capturedPhone?: string | null;
  source: WhatsAppPhoneCaptureSource;
  sourceChannel?: "WEB" | "TELEGRAM";
}): Promise<WhatsAppPhoneSelection | null> {
  const captured = capturedPhone?.trim() || null;
  if (captured && !normalizeMexicanPhone(captured)) {
    throw new Error("Captura un teléfono mexicano válido de 10 dígitos.");
  }

  let selection = selectWhatsAppPhone({ primary: client.phone, secondary: client.secondaryPhone });
  if (!captured) return selection;

  const capturedNormalized = normalizeMexicanPhone(captured);
  if (!capturedNormalized) throw new Error("Captura un teléfono mexicano válido de 10 dígitos.");
  // Synthetic demo phones are intentionally ignored by selectWhatsAppPhone,
  // so a captured number can replace them. Keep the raw values in the
  // optimistic predicate below to reject concurrent edits.
  const existing = selection?.normalized ?? null;
  if (existing && existing !== capturedNormalized) {
    throw new Error("El teléfono del cliente cambió; vuelve a intentarlo para evitar sobrescribirlo.");
  }

  if (!existing) {
    const updated = await tx.client.updateMany({
      where: {
        id: client.id,
        organizationId,
        phone: client.phone,
        secondaryPhone: client.secondaryPhone,
      },
      data: { phone: capturedNormalized, updatedById: userId },
    });
    if (updated.count !== 1) {
      throw new Error("El teléfono del cliente cambió; vuelve a intentarlo para evitar sobrescribirlo.");
    }
    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_PHONE_CAPTURED_FOR_WHATSAPP",
      newValue: sourceChannel === "TELEGRAM"
        ? { captured: true, source, sourceChannel }
        : { captured: true, source },
      userId,
      organizationId,
      db: tx,
    });
    return { normalized: capturedNormalized, source: "CAPTURED" };
  }

  selection = selectWhatsAppPhone({ primary: client.phone, secondary: client.secondaryPhone });
  return selection;
}
