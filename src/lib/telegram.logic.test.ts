import { describe, expect, it } from "vitest";
import {
  buildTelegramHelpMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
} from "./telegram-shared";

describe("telegram.shared", () => {
  it("generates a readable hex link code", () => {
    const code = generateTelegramLinkCode();

    expect(code).toMatch(/^[A-F0-9]{12}$/);
  });

  it("normalizes manual link codes before hashing", () => {
    expect(normalizeTelegramLinkCode(" ab-cd 12 ")).toBe("ABCD12");
    expect(hashTelegramLinkCode("ab-cd 12", "secret")).toBe(hashTelegramLinkCode("ABCD12", "secret"));
  });

  it("parses Telegram commands with optional bot usernames", () => {
    expect(parseTelegramCommand("/start")).toEqual({ command: "start", argument: null, raw: "/start" });
    expect(parseTelegramCommand("/help@PolicyDeskBot")).toEqual({
      command: "help",
      argument: null,
      raw: "/help@PolicyDeskBot",
    });
    expect(parseTelegramCommand("/link ABCD12")).toEqual({
      command: "link",
      argument: "ABCD12",
      raw: "/link ABCD12",
    });
    expect(parseTelegramCommand("hello")).toBeNull();
  });

  it("builds concise user-facing replies", () => {
    expect(buildTelegramStartMessage()).toContain("/link CÓDIGO");
    expect(buildTelegramHelpMessage()).toContain("/status");
    expect(buildTelegramLinkSuccessMessage()).toContain("Chat vinculado");
    expect(buildTelegramLinkErrorMessage("Código inválido")).toContain("Código inválido");
    expect(buildTelegramStatusMessage(true)).toContain("vinculado");
    expect(buildTelegramStatusMessage(false)).toContain("todavía no está vinculado");
  });
});
