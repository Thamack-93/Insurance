import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  getNewAssistantReportStatus,
  redactAssistantReportText,
  serializeAssistantEvidence,
} from "@/lib/assistant-reports";

describe("assistant report privacy and versioning", () => {
  it("redacts common identifiers from persisted summaries", () => {
    const result = redactAssistantReportText(
      "Contacto ana@example.com, RFC GODE561231GR8, teléfono 55 1234 5678, póliza 1234567890",
    );

    expect(result).not.toContain("ana@example.com");
    expect(result).not.toContain("GODE561231GR8");
    expect(result).not.toContain("1234567890");
    expect(result).toContain("[email]");
  });

  it("always persists evidence as valid bounded JSON", () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      title: `Señal ${index}`,
      summary: "x".repeat(120),
    }));
    const serialized = serializeAssistantEvidence(entries, 500);

    expect(serialized.length).toBeLessThanOrEqual(500);
    expect(Array.isArray(JSON.parse(serialized))).toBe(true);
  });

  it("restarts a new suggestion version in collecting state", () => {
    expect(getNewAssistantReportStatus({ kind: "SUGGESTION", threshold: 5 })).toBe("COLLECTING");
    expect(getNewAssistantReportStatus({ kind: "SUGGESTION", threshold: 1 })).toBe("OPEN");
    expect(getNewAssistantReportStatus({ kind: "INCIDENT", threshold: 5 })).toBe("OPEN");
  });
});
