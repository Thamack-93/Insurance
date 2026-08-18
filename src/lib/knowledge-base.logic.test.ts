import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GENERAL_INSURANCE_SOURCES } from "@/lib/knowledge-base-general";
import { isKnowledgeContentSafe, requiresInternalKnowledgeEvidence, splitKnowledgeChunks, splitKnowledgeContent } from "@/lib/knowledge-base";

describe("insurance knowledge base rules", () => {
  it("requires internal evidence for contractual questions", () => {
    expect(requiresInternalKnowledgeEvidence("¿Qué exclusiones tiene esta póliza?")).toBe(true);
    expect(requiresInternalKnowledgeEvidence("¿Qué significa prima?")).toBe(false);
    expect(requiresInternalKnowledgeEvidence("¿Qué es un deducible en seguros?")).toBe(false);
    expect(requiresInternalKnowledgeEvidence("¿Qué deducible aplica a mi póliza?")).toBe(true);
  });

  it("splits content into bounded chunks without empty fragments", () => {
    const chunks = splitKnowledgeContent("Uno\n\nDos\n\nTres", 7);
    expect(chunks).toEqual(["Uno", "Dos", "Tres"]);
    expect(chunks.every((chunk) => chunk.length <= 7)).toBe(true);
  });

  it("keeps section metadata for curated headings", () => {
    const chunks = splitKnowledgeChunks("# Auto\n\n## Daños materiales\n\nLa cobertura depende de la póliza.", 200);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ section: "Daños materiales" });
  });

  it("rejects medical or clinical content before indexing", () => {
    expect(isKnowledgeContentSafe("La póliza requiere diagnóstico y estudio clínico.")).toBe(false);
    expect(isKnowledgeContentSafe("Proceso operativo para solicitar una renovación.")).toBe(true);
  });

  it("ships the curated general catalog without legal or regulatory assertions", () => {
    expect(GENERAL_INSURANCE_SOURCES.map((source) => source.product)).toEqual([
      "GENERAL", "OPERACION", "SINIESTROS", "AUTO", "GMM", "VIDA", "HOGAR", "VIAJERO",
    ]);
    for (const source of GENERAL_INSURANCE_SOURCES) {
      expect(source.sourceUrl.startsWith("https://")).toBe(true);
      expect(source.content).not.toMatch(/\b(?:ley|reglamento|artículo|plazo legal|derechos legales)\b/i);
    }
  });
});
