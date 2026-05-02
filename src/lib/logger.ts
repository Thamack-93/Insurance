type ErrorContext = string;

export function logError(context: ErrorContext, error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const payload = {
    level: "error",
    context,
    message,
    ...(stack ? { stack } : {}),
    ...(extra ?? {}),
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
