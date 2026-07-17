import { createHash, randomBytes } from "node:crypto";

export const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 15;
export const TELEGRAM_QUERY_DEFAULT_DAYS = 30;
export const TELEGRAM_QUERY_MAX_DAYS = 365;
export const TELEGRAM_QUERY_RESULT_LIMIT = 20;
export const TELEGRAM_DIGEST_SECTION_LIMIT = 10;

export type TelegramCommandName =
  | "start"
  | "help"
  | "ayuda"
  | "link"
  | "status"
  | "confirmar"
  | "cancelar"
  | "pago"
  | "poliza"
  | "recibos"
  | "renovaciones"
  | "resumen"
  | "vencidos"
  | "hoy"
  | "proximos"
  | "buscar"
  | "tareas"
  | "unknown";

export type TelegramCommand = {
  command: TelegramCommandName;
  argument: string | null;
  raw: string;
};

export function normalizeTelegramLinkCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateTelegramLinkCode() {
  return randomBytes(6).toString("hex").toUpperCase();
}

export function hashTelegramLinkCode(code: string, secret: string) {
  return createHash("sha256")
    .update(`${secret}:${normalizeTelegramLinkCode(code)}`)
    .digest("hex");
}

export function parseTelegramCommand(text: string): TelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [commandToken, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!commandToken) return null;

  const command = commandToken.split("@")[0]?.toLowerCase() ?? "";
  const argument = rest.join(" ").trim() || null;

  if (
    command === "start" ||
    command === "help" ||
    command === "ayuda" ||
    command === "link" ||
    command === "status" ||
    command === "confirmar" ||
    command === "cancelar" ||
    command === "pago" ||
    command === "poliza" ||
    command === "recibos" ||
    command === "renovaciones" ||
    command === "resumen" ||
    command === "vencidos" ||
    command === "hoy" ||
    command === "proximos" ||
    command === "buscar" ||
    command === "tareas"
  ) {
    return {
      command,
      argument,
      raw: trimmed,
    };
  }

  return {
    command: "unknown",
    argument,
    raw: trimmed,
  };
}

export function parseTelegramQueryDays(argument: string | null, defaultDays = TELEGRAM_QUERY_DEFAULT_DAYS) {
  if (!argument) {
    return { ok: true as const, days: defaultDays };
  }

  const normalized = argument.trim();
  if (!/^\d+$/.test(normalized)) {
    return {
      ok: false as const,
      error: `Usa un número de días entre 1 y ${TELEGRAM_QUERY_MAX_DAYS}.`,
    };
  }

  const days = Number(normalized);
  if (!Number.isSafeInteger(days) || days < 1 || days > TELEGRAM_QUERY_MAX_DAYS) {
    return {
      ok: false as const,
      error: `Usa un número de días entre 1 y ${TELEGRAM_QUERY_MAX_DAYS}.`,
    };
  }

  return { ok: true as const, days };
}

export function buildTelegramStartMessage() {
  return [
    "PolicyDesk Telegram está listo para vincular este chat.",
    "",
    "Genera un código desde Configuración > Notificaciones y envía /link CÓDIGO en este chat privado.",
    "Después podrás usar /status para revisar el estado del vínculo y /ayuda para ver los comandos útiles.",
    "Los cambios reales por Telegram están desactivados por defecto; actívalos en Configuración > Notificaciones si los necesitas.",
  ].join("\n");
}

export function buildTelegramHelpMessage() {
  return [
    "Comandos útiles:",
    "/start - Instrucciones de vinculación.",
    "/ayuda - Mostrar este resumen. /help también funciona.",
    "/link <código> - Vincular este chat con tu cuenta de PolicyDesk.",
    "/status - Ver si este chat ya está vinculado.",
    "",
    "Consulta:",
    "/resumen - Resumen diario en cualquier momento.",
    "/vencidos [página] - Cobros vencidos.",
    "/hoy - Cobros de hoy.",
    "/proximos [días] [página] - Cobros próximos.",
    "/recibos [días] [página] - Cobros vencidos y próximos.",
    "/renovaciones [días] [página] - Renovaciones próximas.",
    "/tareas [días] [página] - Tareas abiertas próximas.",
    "/buscar <texto> - Buscar clientes, pólizas, recibos, tareas o archivos.",
    "",
    "Captura:",
    "/pago <póliza> <recibo> [hoy|YYYY-MM-DD] <método> - Preparar un pago.",
    "/poliza [campos] - Preparar una póliza y seguirla en PolicyDesk.",
    "/confirmar - Confirmar el borrador activo.",
    "/cancelar - Cancelar el borrador activo.",
    "",
    "Si falta información, el bot te la irá pidiendo paso a paso.",
    "Los cambios reales por Telegram están desactivados por defecto; actívalos en Configuración > Notificaciones.",
  ].join("\n");
}

export function buildTelegramLinkSuccessMessage() {
  return [
    "Chat vinculado correctamente.",
    "Ya puedes recibir notificaciones de PolicyDesk en Telegram.",
    "Usa /status cuando quieras confirmar el estado.",
  ].join("\n");
}

export function buildTelegramStatusMessage(connected: boolean, mutationsEnabled = false) {
  return connected
    ? [
        "Este chat ya está vinculado con PolicyDesk.",
        "Telegram está activo para este usuario.",
        mutationsEnabled
          ? "Los cambios reales por Telegram están habilitados."
          : "Los cambios reales por Telegram están deshabilitados. Actívalos en Configuración > Notificaciones.",
        "Usa /help para ver los comandos disponibles.",
      ].join("\n")
    : [
        "Este chat todavía no está vinculado.",
        "Genera un código desde Configuración > Notificaciones y usa /link CÓDIGO aquí.",
      ].join("\n");
}

export function buildTelegramLinkErrorMessage(reason: string) {
  return [reason, "Revisa el código o genera uno nuevo desde PolicyDesk."].join("\n");
}

export function buildTelegramLinkedChatRequiredMessage() {
  return [
    "Este comando solo está disponible para chats vinculados.",
    "Genera un código desde Configuración > Notificaciones y usa /link CÓDIGO aquí.",
  ].join("\n");
}

export function buildTelegramFallbackMessage() {
  return [
    "No reconocí ese comando.",
    "Usa /ayuda para ver los comandos disponibles.",
  ].join("\n");
}

export function buildTelegramPaymentDraftMessage(details: {
  policyNumber: string;
  receiptNumber: string;
  originLabel?: string;
  clientName: string;
  amount: string;
  paymentMethod: string;
  paidDate: string;
  reference?: string | null;
}) {
  return [
    "Borrador de pago preparado.",
    `Póliza: ${details.policyNumber}`,
    `Recibo: ${details.receiptNumber} · ${details.clientName}`,
    details.originLabel ? `Origen: ${details.originLabel}` : null,
    `Total del recibo: ${details.amount}`,
    `Método: ${details.paymentMethod} · Fecha: ${details.paidDate}`,
    details.reference ? `Referencia: ${details.reference}` : null,
    "",
    "Responde /confirmar para registrar el pago o /cancelar para descartarlo.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTelegramPolicyDraftMessage(details: {
  policyNumber: string | null;
  summary: string;
  link?: string | null;
}) {
  return [
    "Borrador de póliza preparado.",
    details.policyNumber ? `Póliza: ${details.policyNumber}` : null,
    details.summary,
    details.link ? `Abre este enlace para terminarla en PolicyDesk: ${details.link}` : "Abre PolicyDesk para completar la captura.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTelegramDraftConfirmedMessage(label: string) {
  return [`${label} confirmado.`, "El borrador se guardó y quedó auditado."].join("\n");
}

export function buildTelegramDraftCancelledMessage(label: string) {
  return [`${label} cancelado.`, "El borrador fue descartado."].join("\n");
}
