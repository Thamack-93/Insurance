import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { daysBetweenBusinessDates } from "@/lib/business-dates";
import { buildWhatsAppUrl, isSafeWhatsAppUrl } from "@/lib/whatsapp";
export type { WhatsAppPhoneSelection, WhatsAppPhoneSource } from "@/lib/whatsapp";
export { buildWhatsAppUrl, isSafeWhatsAppUrl, selectWhatsAppPhone } from "@/lib/whatsapp";

export const WHATSAPP_RECEIPT_TEMPLATE = "receipt_due_v1" as const;
function policySuffix(policyNumber: string) {
  const compact = policyNumber.trim().replace(/\s+/g, "");
  return compact.slice(-4) || "—";
}

function duePhrase(dueDate: Date | string, now: Date | string) {
  const difference = daysBetweenBusinessDates(dueDate, now);
  if (difference === 0) return "vence hoy";
  if (difference > 0) return `vence el ${formatDate(dueDate)}`;
  return `venció el ${formatDate(dueDate)}`;
}

export function buildReceiptDueMessage({
  clientName,
  insurerName,
  policyNumber,
  dueDate,
  amount,
  currency,
  now = new Date(),
}: {
  clientName: string;
  insurerName: string;
  policyNumber: string;
  dueDate: Date | string;
  amount: number | string | { toNumber: () => number };
  currency: string;
  now?: Date | string;
}) {
  return [
    `Hola, ${clientName.trim()}. Espero que estés muy bien.`,
    `Te comparto un recordatorio: tu recibo de ${insurerName.trim()}, correspondiente a la póliza ••••${policySuffix(policyNumber)}, ${duePhrase(dueDate, now)} por ${formatCurrency(amount, currency)}.`,
    "Si ya realizaste el pago, por favor ignora este mensaje. Si necesitas apoyo, con gusto te ayudo.",
  ].join("\n\n");
}

export function buildWhatsAppReminderUrl(phone: string, message: string) {
  return buildWhatsAppUrl(phone, message);
}

export function isSafeWhatsAppReminderUrl(value: string) {
  return isSafeWhatsAppUrl(value);
}
