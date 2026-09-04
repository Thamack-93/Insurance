/** Seed/demo contacts are for display only. They must never become outbound
 * recipients until a user replaces and confirms the contact data. */
export function isSyntheticOutboundEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return Boolean(email && (/@policydesk\.local$/.test(email) || /\.invalid$/.test(email)));
}

export function isSyntheticOutboundPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  return ["5512345678", "5555555555", "0000000000", "5210000000000"].includes(digits);
}
