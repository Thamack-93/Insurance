export type SerialRenewalIdentity = {
  clientId: string;
  insurerId?: string;
  policyType: string;
  startDate?: Date;
  endDate?: Date;
  serialNumbers: Array<string | null | undefined>;
};

export type SerialRenewalMatch = {
  serialNumber: string;
  gapDays: number;
  confidence: number;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const RENEWAL_MATCH_EARLIEST_START_GAP_DAYS = -30;
export const RENEWAL_MATCH_LATEST_START_GAP_DAYS = 45;

export function normalizePolicySerial(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function utcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function getRenewalStartGapDays(sourceEndDate: Date, targetStartDate: Date) {
  return Math.round((utcDay(targetStartDate) - utcDay(sourceEndDate)) / DAY_MS);
}

export function matchSerialRenewal(source: SerialRenewalIdentity, target: SerialRenewalIdentity): SerialRenewalMatch | null {
  if (!source.clientId || source.clientId !== target.clientId) return null;
  if (source.policyType !== "AUTO" || target.policyType !== "AUTO" || !source.endDate || !target.startDate) return null;

  const sourceSerials = new Set(source.serialNumbers.map(normalizePolicySerial).filter(Boolean));
  const sharedSerial = target.serialNumbers.map(normalizePolicySerial).find((serial) => serial && sourceSerials.has(serial));
  if (!sharedSerial) return null;

  const gapDays = getRenewalStartGapDays(source.endDate, target.startDate);
  if (gapDays < RENEWAL_MATCH_EARLIEST_START_GAP_DAYS || gapDays > RENEWAL_MATCH_LATEST_START_GAP_DAYS) return null;

  const confidence = gapDays >= -7 && gapDays <= 15 ? 0.99 : 0.95;
  const timing = gapDays === 0
    ? "vigencias consecutivas"
    : gapDays < 0
      ? `la nueva inicia ${Math.abs(gapDays)} días antes del vencimiento`
      : `la nueva inicia ${gapDays} días después del vencimiento`;

  return {
    serialNumber: sharedSerial,
    gapDays,
    confidence,
    reason: `Misma serie/VIN y cliente; ${timing}.`,
  };
}
