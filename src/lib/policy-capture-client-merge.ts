import { normalizeCaptureIdentity, scoreCaptureIdentity } from "@/lib/policy-pdf-capture.shared";

export type CaptureClientCandidate = {
  id: string;
  fullName: string;
  rfc: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  birthDate: Date | null;
  type: string;
};

export type CaptureClientIncomingData = {
  fullName: string;
  rfc?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  birthDate?: Date | null;
};

function canonical(value: string | null | undefined) {
  return normalizeCaptureIdentity(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function nonEmpty(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null;
}

export function chooseCaptureClient(
  incoming: Pick<CaptureClientIncomingData, "fullName" | "rfc">,
  candidates: CaptureClientCandidate[],
) {
  const rfc = canonical(incoming.rfc);
  const rfcMatches = rfc ? candidates.filter((candidate) => canonical(candidate.rfc) === rfc) : [];
  const nameMatches = candidates
    .map((candidate) => ({ candidate, score: scoreCaptureIdentity(incoming.fullName, candidate.fullName) }))
    .filter((entry) => entry.score >= 80)
    .sort((left, right) => right.score - left.score || left.candidate.fullName.localeCompare(right.candidate.fullName));

  const bestName = nameMatches[0]?.candidate ?? null;
  if (rfcMatches.length > 0 && bestName && rfcMatches[0]?.id !== bestName.id) {
    return { candidate: null, conflict: "El RFC detectado pertenece a otro cliente distinto al nombre de la captura." };
  }
  if (rfcMatches.length === 1) return { candidate: rfcMatches[0]!, conflict: null };
  if (bestName && (!nameMatches[1] || (nameMatches[0]?.score ?? 0) > (nameMatches[1]?.score ?? 0))) {
    return { candidate: bestName, conflict: null };
  }
  return { candidate: null, conflict: null };
}

export function buildCaptureClientEnrichment(existing: CaptureClientCandidate, incoming: CaptureClientIncomingData) {
  const updates: Partial<Pick<CaptureClientCandidate, "rfc" | "email" | "phone" | "address" | "birthDate">> = {};
  const conflicts: Array<{ field: keyof typeof updates; existing: string | null; incoming: string | null }> = [];
  const incomingText: Record<"rfc" | "email" | "phone" | "address", string | null> = {
    rfc: nonEmpty(incoming.rfc)?.toUpperCase() ?? null,
    email: nonEmpty(incoming.email),
    phone: nonEmpty(incoming.phone),
    address: nonEmpty(incoming.address),
  };

  for (const field of ["rfc", "email", "phone", "address"] as const) {
    const next = incomingText[field];
    const current = nonEmpty(existing[field]);
    if (!next) continue;
    if (!current) {
      updates[field] = next;
    } else if (canonical(current) !== canonical(next)) {
      conflicts.push({ field, existing: current, incoming: next });
    }
  }

  if (incoming.birthDate) {
    if (!existing.birthDate) {
      updates.birthDate = incoming.birthDate;
    } else if (existing.birthDate.getTime() !== incoming.birthDate.getTime()) {
      conflicts.push({
        field: "birthDate",
        existing: existing.birthDate.toISOString().slice(0, 10),
        incoming: incoming.birthDate.toISOString().slice(0, 10),
      });
    }
  }

  return { updates, conflicts };
}
