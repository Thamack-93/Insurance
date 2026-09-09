import { normalizeMexicanPhone } from "@/lib/phone";
import { isSyntheticOutboundPhone } from "@/lib/outbound-contact-guard";

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
    if (isSyntheticOutboundPhone(value)) continue;
    const normalized = normalizeMexicanPhone(value);
    if (normalized) return { normalized, source };
  }
  return null;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const normalized = normalizeMexicanPhone(phone);
  if (!normalized) throw new Error("INVALID_MEXICAN_PHONE");
  return `https://wa.me/${normalized.slice(1)}?text=${encodeURIComponent(message)}`;
}

export function isSafeWhatsAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const params = Array.from(url.searchParams.keys());
    return (
      url.protocol === "https:" &&
      url.hostname === "wa.me" &&
      !/^https:\/\/wa\.me:/i.test(value) &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      /^\/[0-9]{12}$/.test(url.pathname) &&
      params.length === 1 &&
      params[0] === "text" &&
      url.searchParams.get("text") !== null
    );
  } catch {
    return false;
  }
}
