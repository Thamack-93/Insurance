type ErrorContext = string;

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|cookie|session|webhookurl|webhookSecret|apiKey|bearer|filename|fileName|document|content|email|phone|rfc|address|personal|body|text)/i;

function sanitizeText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "[REDACTED_PHONE]")
    .replace(/\b[^\s/\\]+\.(?:pdf|docx?|xlsx?|csv|png|jpe?g|webp)\b/gi, "[REDACTED_FILE]");
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(value.message),
      stack: value.stack ? sanitizeText(value.stack) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, "[REDACTED]"] as const;
      }
      return [key, sanitizeValue(entry)] as const;
    });
    return Object.fromEntries(entries);
  }

  if (typeof value === "string") {
    if (/^bearer\s+/i.test(value)) return "[REDACTED]";
    const sanitized = sanitizeText(value);
    if (sanitized.length > 2000) return `${sanitized.slice(0, 2000)}…`;
    return sanitized;
  }

  return value;
}

export function logError(context: ErrorContext, error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const sanitized = extra ? sanitizeValue(extra) : undefined;
  const sanitizedExtra =
    sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : undefined;
  const payload = {
    level: "error",
    context,
    message: sanitizeValue(message),
    ...(stack ? { stack: sanitizeText(stack) } : {}),
    ...(sanitizedExtra ?? {}),
    timestamp: new Date().toISOString(),
  };

  if (typeof console !== "undefined") {
    console.error(`[${context}]`, JSON.stringify(payload));
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
