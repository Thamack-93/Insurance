import {
  getRenewalStartGapDays,
  RENEWAL_MATCH_EARLIEST_START_GAP_DAYS,
  RENEWAL_MATCH_LATEST_START_GAP_DAYS,
} from "@/lib/policy-renewal-match.logic";

/**
 * One explicit policy term may renew another only when their identity and
 * coverage periods are compatible. The same official policy number alone
 * never establishes a renewal relationship.
 *
 * This is shared between the draft preview and the server-side write path.
 */
export type RenewalLinkIdentity = {
  id?: string;
  clientId: string;
  insurerId: string;
  policyType: string;
  startDate: Date;
  endDate: Date;
};

export function validateRenewalLink(
  source: RenewalLinkIdentity,
  target: RenewalLinkIdentity,
): string | null {
  if (source.id && target.id && source.id === target.id) {
    return "Una póliza no puede renovarse a sí misma.";
  }
  if (!source.clientId || source.clientId !== target.clientId) {
    return "La póliza anterior pertenece a otro cliente. Revisa el vínculo de renovación.";
  }
  if (!source.insurerId || source.insurerId !== target.insurerId) {
    return "La aseguradora no coincide con la póliza anterior. Revisa el vínculo antes de guardar.";
  }
  if (!source.policyType || source.policyType !== target.policyType) {
    return "El ramo no coincide con la póliza anterior. Revisa el vínculo de renovación.";
  }

  const dates = [source.startDate, source.endDate, target.startDate, target.endDate];
  if (dates.some((date) => !(date instanceof Date) || !Number.isFinite(date.getTime()))) {
    return "No se pudieron verificar las vigencias. Revisa las fechas de ambas pólizas.";
  }
  if (target.startDate.getTime() <= source.startDate.getTime()
    || target.endDate.getTime() <= source.endDate.getTime()) {
    return "La nueva vigencia debe ser posterior a la vigencia anterior.";
  }

  const gapDays = getRenewalStartGapDays(source.endDate, target.startDate);
  if (gapDays < RENEWAL_MATCH_EARLIEST_START_GAP_DAYS
    || gapDays > RENEWAL_MATCH_LATEST_START_GAP_DAYS) {
    return "Las vigencias están demasiado separadas o solapadas para vincularlas automáticamente. Revisa la póliza anterior seleccionada.";
  }

  return null;
}
