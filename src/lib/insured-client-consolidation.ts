const INSURED_MARKER = "ASEGURADO:";

export type InsuredClientNameParts = {
  contractorName: string;
  insuredName: string;
  hasMarker: boolean;
};

export function normalizePersonKey(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function splitInsuredClientName(fullName: string): InsuredClientNameParts {
  const text = fullName.trim();
  const markerIndex = text.toUpperCase().indexOf(INSURED_MARKER);

  if (markerIndex === -1) {
    return {
      contractorName: text,
      insuredName: text,
      hasMarker: false,
    };
  }

  const contractorName = text.slice(0, markerIndex).replace(/-\s*$/g, "").trim();
  const insuredName = text.slice(markerIndex + INSURED_MARKER.length).trim();

  return {
    contractorName: contractorName || text,
    insuredName: insuredName || contractorName || text,
    hasMarker: true,
  };
}

export function isInsuredClientName(fullName: string) {
  return fullName.toUpperCase().includes(INSURED_MARKER);
}

export function mergeTextField(current: string | null | undefined, incoming: string | null | undefined) {
  const currentText = current?.trim();
  if (currentText) return currentText;

  const incomingText = incoming?.trim();
  return incomingText || null;
}

