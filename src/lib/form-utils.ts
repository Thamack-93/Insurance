import { formatBusinessDateInput, parseBusinessDateInput } from "@/lib/business-dates";

export function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function optionalRelationId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function parseDateInput(value: string) {
  return parseBusinessDateInput(value);
}

export function formatDateInput(value: Date | string | null | undefined) {
  return formatBusinessDateInput(value);
}
