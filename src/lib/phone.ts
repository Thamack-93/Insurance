export function normalizeMexicanPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  const local = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return /^\d{10}$/.test(local) ? `+52${local}` : null;
}

export function isValidMexicanPhone(value: string | null | undefined): value is string {
  return normalizeMexicanPhone(value) !== null;
}

export function maskMexicanPhone(value: string | null | undefined) {
  const normalized = normalizeMexicanPhone(value);
  return normalized ? `••••••${normalized.slice(-4)}` : "••••";
}
