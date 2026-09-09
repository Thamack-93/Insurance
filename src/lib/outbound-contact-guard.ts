/** Seed/demo contacts are display-only and must not become outbound recipients. */
export function isSyntheticOutboundEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return Boolean(email && (/@policydesk\.local$/.test(email) || /\.invalid$/.test(email)));
}

export function isSyntheticOutboundPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return true;

  // Stored Mexican phones may be either local 10-digit values or canonical
  // `+52` values. Compare the local portion so the same demo placeholder is
  // blocked in both formats.
  const local = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  if (/^(\d)\1+$/.test(local)) return true;
  return ["5555555555", "0000000000", "1000000000"].includes(local)
    || digits === "5210000000000";
}
