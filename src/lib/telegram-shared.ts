import { createHash, randomBytes } from "node:crypto";

export const TELEGRAM_LINK_TOKEN_TTL_MINUTES = 15;

export type TelegramCommandName = "start" | "help" | "link" | "status" | "unknown";

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

  if (command === "start" || command === "help" || command === "link" || command === "status") {
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

export function buildTelegramStartMessage() {
  return [
    "PolicyDesk Telegram está listo para vincular este chat.",
    "",
    "Genera un código desde Configuración > Notificaciones y envía /link CÓDIGO en este chat privado.",
    "Después podrás usar /status para revisar el estado del vínculo.",
  ].join("\n");
}

export function buildTelegramHelpMessage() {
  return [
    "Comandos disponibles:",
    "/start - Ver instrucciones de vinculación.",
    "/help - Mostrar este resumen.",
    "/link <código> - Vincular este chat con tu cuenta de PolicyDesk.",
    "/status - Ver si este chat ya está vinculado.",
  ].join("\n");
}

export function buildTelegramLinkSuccessMessage() {
  return [
    "Chat vinculado correctamente.",
    "Ya puedes recibir notificaciones de PolicyDesk en Telegram.",
    "Usa /status cuando quieras confirmar el estado.",
  ].join("\n");
}

export function buildTelegramStatusMessage(connected: boolean) {
  return connected
    ? [
        "Este chat ya está vinculado con PolicyDesk.",
        "Telegram está activo para este usuario.",
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

export function buildTelegramFallbackMessage() {
  return [
    "No reconocí ese comando.",
    "Usa /help para ver las instrucciones de vinculación.",
  ].join("\n");
}
