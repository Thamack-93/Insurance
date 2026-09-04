/** Seed/demo contacts are display-only and must not become outbound recipients. */
export function isSyntheticOutboundEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return Boolean(email && (/@policydesk\.local$/.test(email) || /\.invalid$/.test(email)));
}

export function isSyntheticOutboundPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  return ["5555555555", "0000000000", "5210000000000"].includes(digits);
}
