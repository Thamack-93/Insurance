import { randomBytes } from "node:crypto";

export const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string") return "La contraseña no es válida.";
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "La contraseña debe combinar letras y números.";
  }
  return null;
}

export function generateTemporaryPassword(): string {
  // URL-safe random material plus deterministic classes required by policy.
  return `${randomBytes(18).toString("base64url")}A1`;
}

export function temporaryPasswordExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + TEMPORARY_PASSWORD_TTL_MS);
}
