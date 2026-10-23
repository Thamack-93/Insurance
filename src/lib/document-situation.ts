type DateStatusRecord = { status: string; endDate: Date };
type StatusRecord = { status: string };
type QuoteStatusRecord = { status: string; validUntil: Date | null };

export type DocumentSituationInput = {
  clientId?: string | null;
  policyId?: string | null;
  endorsementId?: string | null;
  receiptId?: string | null;
  taskId?: string | null;
  claimId?: string | null;
  quoteId?: string | null;
  client?: unknown | null;
  policy?: DateStatusRecord | null;
  endorsement?: DateStatusRecord | null;
  receipt?: StatusRecord | null;
  task?: StatusRecord | null;
  claim?: StatusRecord | null;
  quote?: QuoteStatusRecord | null;
};

export type DocumentSituation = {
  label: "Vigente" | "En curso" | "Histórico" | "Sin expediente";
  className: string;
};

const ACTIVE_BADGE = "border-emerald-200 bg-emerald-50 text-emerald-800";
const IN_PROGRESS_BADGE = "border-blue-200 bg-blue-50 text-blue-800";
const HISTORICAL_BADGE = "border-stone-200 bg-stone-100 text-stone-700";
const UNASSOCIATED_BADGE = "border-amber-200 bg-amber-50 text-amber-800";

function isCurrent(endDate: Date, today: Date) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  return end >= startOfToday;
}

function result(label: DocumentSituation["label"]): DocumentSituation {
  const className = label === "Vigente"
    ? ACTIVE_BADGE
    : label === "En curso"
      ? IN_PROGRESS_BADGE
      : label === "Sin expediente"
        ? UNASSOCIATED_BADGE
        : HISTORICAL_BADGE;
  return { label, className };
}

/** Describes the linked record lifecycle; a stored file is never inherently active. */
export function getDocumentSituation(document: DocumentSituationInput, today = new Date()): DocumentSituation {
  if (document.endorsement) {
    return result(document.endorsement.status === "ACTIVE" && isCurrent(document.endorsement.endDate, today) ? "Vigente" : "Histórico");
  }
  if (document.receipt) {
    return result(["PENDING", "OVERDUE"].includes(document.receipt.status) ? "En curso" : "Histórico");
  }
  if (document.claim) {
    return result(["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER"].includes(document.claim.status) ? "En curso" : "Histórico");
  }
  if (document.task) {
    return result(["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER", "WAITING_DOCUMENT", "SENT"].includes(document.task.status) ? "En curso" : "Histórico");
  }
  if (document.quote) {
    const validityExpired = document.quote.validUntil !== null && !isCurrent(document.quote.validUntil, today);
    return result(!validityExpired && ["REQUESTED", "IN_PROGRESS", "SENT"].includes(document.quote.status) ? "En curso" : "Histórico");
  }
  if (document.policy) {
    if (document.policy.status === "PENDING") return result("En curso");
    return result(document.policy.status === "ACTIVE" && isCurrent(document.policy.endDate, today) ? "Vigente" : "Histórico");
  }

  const hasRecordReference = Boolean(document.clientId || document.policyId || document.endorsementId || document.receiptId || document.taskId || document.claimId || document.quoteId);
  if (hasRecordReference && !document.client && !document.policy && !document.endorsement && !document.receipt && !document.task && !document.claim && !document.quote) {
    return result("Sin expediente");
  }
  return result(document.client ? "Histórico" : "Sin expediente");
}
