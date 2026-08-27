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
  | "pagoqualitas"
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
    command === "pagoqualitas" ||
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
    "/pagoqualitas <póliza> - Solicitar un enlace de pago de Quálitas.",
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

export function buildTelegramQualitasUnavailableMessage() {
  return "La integración de enlaces de pago de Quálitas no está disponible en este momento.";
}

export function buildTelegramQualitasPolicyPrompt() {
  return "Escribe el número de póliza de Quálitas.";
}

export function buildTelegramQualitasRecipientPrompt(input: {
  clientEmail: string | null;
  agentEmail: string | null;
}) {
  const lines = ["¿A quién quieres que Quálitas envíe el enlace de pago?", ""];
  if (input.clientEmail && input.agentEmail) {
    lines.push(`Cliente: ${input.clientEmail}`, `Agente: ${input.agentEmail}`);
  } else if (input.clientEmail) {
    lines.push("El agente actual no tiene un correo válido registrado en PolicyDesk.", `Cliente: ${input.clientEmail}`);
  } else if (input.agentEmail) {
    lines.push("El cliente no tiene un correo registrado en PolicyDesk.", `Agente: ${input.agentEmail}`);
  }
  return lines.join("\n");
}

export function buildTelegramQualitasNoRecipientMessage() {
  return "No hay un correo válido disponible ni para el cliente ni para el agente.\nActualiza el correo correspondiente en PolicyDesk antes de continuar.";
}

export function buildTelegramQualitasConfirmation(input: {
  policyNumber: string;
  clientName: string;
  recipientLabel: "Cliente" | "Agente";
  maskedEmail: string;
}) {
  return [
    "Confirmar solicitud de enlace Quálitas",
    "",
    `Póliza: ${input.policyNumber}`,
    `Cliente: ${input.clientName}`,
    `Enviar a: ${input.recipientLabel} · ${input.maskedEmail}`,
    "",
    "Responde /confirmar para solicitarlo o /cancelar para descartarlo.",
  ].join("\n");
}

export function buildTelegramQualitasSuccess(input: {
  policyNumber: string;
  recipientLabel: "Cliente" | "Agente";
  maskedEmail: string;
}) {
  return [
    "Solicitud enviada a Quálitas.",
    "",
    `El enlace de pago para la póliza •••${input.policyNumber.slice(-4)} fue solicitado para:`,
    `${input.recipientLabel} · ${input.maskedEmail}`,
  ].join("\n");
}

export function buildTelegramQualitasOutcomeMessage(outcome: string, reason?: string) {
  switch (reason) {
    case "DUPLICATE_LINK_99991":
      return "Quálitas reportó que ya existe una liga de pago en curso. No se generó otra.";
    case "FINAL_RESPONSE_UNRECOGNIZED":
      return "Quálitas respondió al envío, pero PolicyDesk no reconoció el acuse. No se reenviará automáticamente.";
    case "FINAL_TIMEOUT":
      return "Quálitas no confirmó el resultado antes del límite. No se reenviará automáticamente.";
    case "FLOW_CHANGED":
      return "El portal de Quálitas cambió y el envío no pudo completarse.";
  }
  switch (outcome) {
    case "POLICY_NOT_FOUND": return "Quálitas no reconoció la póliza. No se envió ningún enlace.";
    case "POLICY_NOT_ELIGIBLE": return "Quálitas indica que esta póliza no puede usar este flujo de pago.";
    case "EMAIL_REJECTED": return "Quálitas rechazó el correo seleccionado. No se envió el enlace.";
    case "UNCERTAIN": return "No pude confirmar si Quálitas procesó la solicitud.\n\nPara evitar enviar enlaces duplicados, PolicyDesk no la reenviará automáticamente.";
    case "RATE_LIMITED": return "Se alcanzó el límite temporal de solicitudes a Quálitas. Intenta nuevamente más tarde.";
    case "QUALITAS_UNAVAILABLE":
    case "TIMEOUT": return "Quálitas no está respondiendo en este momento. Intenta nuevamente más tarde.";
    default: return "No se pudo completar la solicitud de enlace de pago de Quálitas.";
  }
}
