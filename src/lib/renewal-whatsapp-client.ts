import { isSafeWhatsAppUrl } from "@/lib/whatsapp";

export type WhatsAppDeviceSignals = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function isMobileWhatsAppDevice({ userAgent = "", platform = "", maxTouchPoints = 0 }: WhatsAppDeviceSignals): boolean {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent) || /iPhone|iPad|iPod/i.test(platform)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function buildWhatsAppAppUrl(webUrl: string): string | null {
  if (!isSafeWhatsAppUrl(webUrl)) return null;
  const url = new URL(webUrl);
  const phone = url.pathname.slice(1);
  const message = url.searchParams.get("text");
  if (!message) return null;
  return `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`;
}
