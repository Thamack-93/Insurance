import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isKnowledgeContentSafe, requiresInternalKnowledgeEvidence, splitKnowledgeContent } from "@/lib/knowledge-base";

describe("insurance knowledge base rules", () => {
  it("requires internal evidence for contractual questions", () => {
    expect(requiresInternalKnowledgeEvidence("¿Qué exclusiones tiene esta póliza?")).toBe(true);
    expect(requiresInternalKnowledgeEvidence("¿Qué significa prima?")).toBe(false);
  });

  it("splits content into bounded chunks without empty fragments", () => {
    const chunks = splitKnowledgeContent("Uno\n\nDos\n\nTres", 7);
    expect(chunks).toEqual(["Uno", "Dos", "Tres"]);
    expect(chunks.every((chunk) => chunk.length <= 7)).toBe(true);
  });

  it("rejects medical or clinical content before indexing", () => {
    expect(isKnowledgeContentSafe("La póliza requiere diagnóstico y estudio clínico.")).toBe(false);
    expect(isKnowledgeContentSafe("Proceso operativo para solicitar una renovación.")).toBe(true);
  });
});
