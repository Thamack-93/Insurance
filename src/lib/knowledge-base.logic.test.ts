import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GENERAL_INSURANCE_SOURCES } from "@/lib/knowledge-base-general";
import { buildKnowledgeFallbackQuery, buildKnowledgeSearchQuery, isKnowledgeContentSafe, requiresInternalKnowledgeEvidence, splitKnowledgeChunks, splitKnowledgeContent } from "@/lib/knowledge-base";
import { buildKnowledgeManifest, hashKnowledgeManifest, KNOWLEDGE_INTEGRITY_VERSION } from "@/lib/knowledge-integrity";
import { calibrateKnowledgeThreshold, KNOWLEDGE_EVALUATION_FIXTURE } from "@/lib/knowledge-evaluation";

describe("insurance knowledge base rules", () => {
  it("requires internal evidence for contractual questions", () => {
    expect(requiresInternalKnowledgeEvidence("¿Qué exclusiones tiene esta póliza?")).toBe(true);
    expect(requiresInternalKnowledgeEvidence("¿Qué significa prima?")).toBe(false);
    expect(requiresInternalKnowledgeEvidence("¿Qué es un deducible en seguros?")).toBe(false);
    expect(requiresInternalKnowledgeEvidence("¿Qué deducible aplica a mi póliza?")).toBe(true);
  });

  it("removes question framing before full-text retrieval", () => {
    expect(buildKnowledgeSearchQuery("¿Qué significa prima?")).toBe("prima");
    expect(buildKnowledgeSearchQuery("¿Qué es un deducible en seguros?")).toBe("deducible");
    expect(buildKnowledgeSearchQuery("¿Qué deducible aplica a mi póliza?")).toBe("deducible aplica poliza");
    expect(buildKnowledgeSearchQuery("¿Qué suele cubrir un seguro de Auto?")).toBe("cobertura auto");
    expect(buildKnowledgeSearchQuery("¿Qué pasos operativos siguen después de reportar un siniestro?")).toBe("paso operativo reporte siniestro");
  });

  it("builds an OR fallback for natural-language variants", () => {
    expect(buildKnowledgeFallbackQuery("¿Qué suele cubrir un seguro de Auto?").split(" | ")).toEqual(expect.arrayContaining(["cobertura:*", "coberturas:*", "auto:*", "automóvil:*"]));
    expect(buildKnowledgeFallbackQuery("¿Qué necesito para un reembolso de GMM?").split(" | ")).toEqual(expect.arrayContaining(["reembolso:*", "reembolsos:*", "gmm:*"]));
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
    const gmm = GENERAL_INSURANCE_SOURCES.find((source) => source.product === "GMM");
    expect(gmm?.content).toMatch(/Ruta administrativa de reembolso/i);
    expect(gmm?.content).toMatch(/Ruta administrativa de pago directo/i);
    expect(gmm?.content).toMatch(/Ruta administrativa de cirugía programada/i);
    expect(gmm?.content).toMatch(/Qué hacer ante una hospitalización/i);
  });

  it("builds a canonical manifest independent of chunk input order", () => {
    const chunks = [
      { ordinal: 1, page: 2, section: "Deducible", content: "10%" },
      { ordinal: 0, page: 1, section: "Cobertura", content: "Daños" },
    ];
    expect(buildKnowledgeManifest("Auto", "2026", chunks)).toContain(`"integrityVersion":"${KNOWLEDGE_INTEGRITY_VERSION}"`);
    expect(hashKnowledgeManifest("Auto", "2026", chunks)).toBe(hashKnowledgeManifest("Auto", "2026", [...chunks].reverse()));
  });

  it("keeps a reproducible 32-case evaluation fixture and deterministic calibration", () => {
    expect(KNOWLEDGE_EVALUATION_FIXTURE).toHaveLength(32);
    const candidates = KNOWLEDGE_EVALUATION_FIXTURE.map((entry, index) => ({
      caseId: entry.id,
      score: 0.4 + (index % 3) * 0.1,
      sourceType: entry.expectedSourceType ?? "GENERAL" as const,
      sourceId: `fixture-${entry.id}`,
    }));
    const calibration = calibrateKnowledgeThreshold(KNOWLEDGE_EVALUATION_FIXTURE, candidates);
    expect(calibration).toBeNull();
  });
});
