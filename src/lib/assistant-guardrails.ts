const DOMAIN_TERMS = [
  "asegur", "poliza", "renov", "recibo", "pago", "cobro", "cliente", "cartera", "prima", "comision",
  "siniestro", "reclamo", "cotizacion", "endoso", "vigencia", "riesgo", "calidad", "pendiente", "tarea",
  "reporte", "export", "documento", "pdf", "telegram", "sistema", "nora", "buscar", "encuentra", "consolid",
  "vincul", "datos", "dashboard", "hoy",
];

const OFF_TOPIC_TERMS = [
  "receta", "cocina", "clima", "pronostico", "politica", "presidente", "eleccion", "futbol", "deporte",
  "pelicula", "serie de tv", "poema", "cuento", "chiste", "horoscopo", "programa en", "codigo de", "capital de",
  "traduceme", "traduce", "tarea escolar",
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
  return tokens.length >= 2 && tokens.every((token) => /^[\p{L}'-]{2,}$/u.test(token));
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
    ["hola", "buenos dias", "buenas tardes", "ayuda", "menu", "que puedes hacer"].includes(normalized) ||
    DOMAIN_TERMS.some((term) => normalized.includes(term))
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
