import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { daysBetweenBusinessDates } from "@/lib/business-dates";
import { normalizeMexicanPhone } from "@/lib/phone";

export const WHATSAPP_RECEIPT_TEMPLATE = "receipt_due_v1" as const;

export type WhatsAppPhoneSource = "PRIMARY" | "SECONDARY" | "CAPTURED";

export type WhatsAppPhoneSelection = {
  normalized: string;
  source: WhatsAppPhoneSource;
};

export function selectWhatsAppPhone({
  primary,
  secondary,
  captured,
}: {
  primary?: string | null;
  secondary?: string | null;
  captured?: string | null;
}): WhatsAppPhoneSelection | null {
  const candidates: Array<[WhatsAppPhoneSource, string | null | undefined]> = [
    ["PRIMARY", primary],
    ["SECONDARY", secondary],
    ["CAPTURED", captured],
  ];

  for (const [source, value] of candidates) {
    const normalized = normalizeMexicanPhone(value);
    if (normalized) return { normalized, source };
  }

  return null;
}

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
  const normalized = normalizeMexicanPhone(phone);
  if (!normalized) throw new Error("El teléfono no es válido.");

  const digits = normalized.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function isSafeWhatsAppReminderUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "wa.me" && /^\d{12}$/.test(url.pathname.slice(1));
  } catch {
    return false;
  }
}
