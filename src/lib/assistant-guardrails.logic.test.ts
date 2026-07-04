import { describe, expect, it } from "vitest";
import { evaluateAssistantInput } from "@/lib/assistant-guardrails";

describe("assistant guardrails", () => {
  it("allows insurance and system requests", () => {
    expect(evaluateAssistantInput("Busca la póliza 12345").allowed).toBe(true);
    expect(evaluateAssistantInput("Necesito un reporte de renovaciones").allowed).toBe(true);
  });

  it("allows concise entity lookups", () => {
    expect(evaluateAssistantInput("María Fernández").reason).toBe("entity_lookup");
    expect(evaluateAssistantInput("ABC-102938").reason).toBe("entity_lookup");
  });

  it("blocks unrelated general-purpose requests", () => {
    expect(evaluateAssistantInput("Dame una receta de pasta").allowed).toBe(false);
    expect(evaluateAssistantInput("Escribe un poema sobre el mar").allowed).toBe(false);
  });
});
