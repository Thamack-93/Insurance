const DOMAIN_TERMS = [
  "asegur", "poliza", "renov", "recibo", "pago", "cobro", "cliente", "cartera", "prima", "comision",
  "siniestro", "reclamo", "cotizacion", "endoso", "vigencia", "riesgo", "calidad", "pendiente", "tarea",
  "consolid", "vincul", "policydesk", "nora", "telegram", "dashboard",
  "captura", "pdf", "documento", "caratula",
];

const OFF_TOPIC_TERMS = [
  "receta", "cocina", "clima", "pronostico", "politica", "presidente", "eleccion", "futbol", "deporte",
  "pelicula", "serie de tv", "poema", "cuento", "chiste", "horoscopo", "programa en", "codigo de", "capital de",
  "traduceme", "traduce", "tarea escolar", "fisica", "cuantica", "historia universal", "matematicas",
];

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

function looksLikeEntityLookup(value: string) {
  const compact = value.replace(/[¿?¡!.,;:]/g, " ").trim();
  const tokens = compact.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  if (tokens.some((token) => /\d/.test(token) && token.length >= 4)) return true;
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every((token) => /^\p{Lu}[\p{L}'-]{1,}$/u.test(token));
}

function hasDomainTerm(value: string) {
  const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
  return DOMAIN_TERMS.some((term) => tokens.some((token) => token.startsWith(term)));
}

export type AssistantGuardrailDecision = {
  allowed: boolean;
  normalized: string;
  reason: "system" | "entity_lookup" | "off_topic" | "unknown";
};

export function evaluateAssistantInput(message: string): AssistantGuardrailDecision {
  const normalized = normalize(message).slice(0, 2_000);
  if (!normalized) return { allowed: false, normalized, reason: "unknown" };

  if (OFF_TOPIC_TERMS.some((term) => normalized.includes(term))) {
    return { allowed: false, normalized, reason: "off_topic" };
  }

  if (
    [
      "hola",
      "buenos dias",
      "buenas tardes",
      "ayuda",
      "menu",
      "que puedes hacer",
      "hoy",
      "today",
      "resumen de hoy",
      "resumen del dia",
      "resumen diario",
      "agenda de hoy",
      "agenda del dia",
      "diario",
    ].includes(normalized) ||
    hasDomainTerm(normalized)
  ) {
    return { allowed: true, normalized, reason: "system" };
  }

  if (looksLikeEntityLookup(message)) {
    return { allowed: true, normalized, reason: "entity_lookup" };
  }

  return { allowed: false, normalized, reason: "unknown" };
}

export function buildAssistantBlockedReply() {
  return "Solo puedo ayudarte con información y flujos de PolicyDesk: clientes, pólizas, renovaciones, recibos, pagos, riesgos, reportes y captura de documentos.";
}

const GMM_SENSITIVE_PATTERNS = [
  /\bdiagn[oó]stic/iu,
  /\bpadec/iu,
  /\bs[ií]ntoma/iu,
  /\benfermedad/iu,
  /\btratamiento/iu,
  /\bmedicamento/iu,
  /\bcirug[ií]a/iu,
  /\bhospital/iu,
  /\blaboratorio/iu,
  /\bestudio/iu,
  /\bresultado/iu,
  /\bm[eé]dic[oa]/iu,
  /\bfactura/iu,
  /\bnota\s+cl[ií]nica/iu,
  /\barchivo/iu,
  /\b(?:dr|dra)\.?\s+[\p{L}]/iu,
  /\b(?:c[aá]ncer|diabetes|hipertensi[oó]n|tumor|fractura|embarazo)\b/iu,
  /\b[\w-]+\.(?:pdf|jpe?g|png|docx?)\b/iu,
];

const GMM_METADATA_ACTIONS = ["checklist", "requisito", "faltante", "pendiente", "recibido", "solicitado", "estado", "seguimiento", "marcar"];

export function evaluateGmmPrivacy(message: string, gmmContext = false) {
  const normalized = normalize(message);
  const hasSensitiveNarrative = GMM_SENSITIVE_PATTERNS.some((pattern) => pattern.test(message));
  const isMetadataAction = GMM_METADATA_ACTIONS.some((term) => normalized.includes(term));
  const allowed = !hasSensitiveNarrative && (!gmmContext || isMetadataAction);
  return { allowed, hasSensitiveNarrative, isMetadataAction };
}

export function buildGmmPrivacyReply() {
  return "Para proteger datos médicos, Nora solo puede trabajar con metadatos del checklist de GMM: requisitos, estados, fechas y seguimientos. No escribas diagnósticos, estudios, médicos, tratamientos ni nombres de archivos; usa el área documental para esos contenidos.";
}
