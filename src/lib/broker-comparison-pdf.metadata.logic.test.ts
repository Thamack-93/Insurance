import { describe, expect, it } from "vitest";
import {
  BROKER_COMPARISON_PILOT_LABEL,
  createBrokerComparisonOption,
  emptyBrokerComparisonDraft,
  parseSavedBrokerComparisonExtraction,
  withSavedBrokerComparisonExtraction,
  type SavedBrokerComparisonExtraction,
} from "@/lib/broker-comparison-pdf.shared";

function savedResult(sourceDocumentId = "doc-1"): SavedBrokerComparisonExtraction {
  return {
    draft: { ...emptyBrokerComparisonDraft(), options: [createBrokerComparisonOption()] },
    warnings: [],
    version: 1,
    status: "REVIEWED",
    sourceDocumentId,
    confirmedAt: "2026-10-14T12:00:00.000Z",
    confirmedById: "user-1",
    pilotLabel: BROKER_COMPARISON_PILOT_LABEL,
  };
}

describe("saved broker comparison metadata", () => {
  it("preserves unrelated metadata and reads a reviewed result tied to the source document", () => {
    const metadata = withSavedBrokerComparisonExtraction(JSON.stringify({ origin: "upload", other: { keep: true } }), savedResult());

    expect(JSON.parse(metadata)).toMatchObject({ origin: "upload", other: { keep: true } });
    expect(parseSavedBrokerComparisonExtraction(metadata, "doc-1")).toMatchObject({ status: "REVIEWED", sourceDocumentId: "doc-1" });
  });

  it("ignores malformed metadata and results belonging to another document", () => {
    expect(parseSavedBrokerComparisonExtraction("{broken", "doc-1")).toBeNull();
    expect(parseSavedBrokerComparisonExtraction(JSON.stringify({ brokerComparisonExtraction: savedResult("doc-2") }), "doc-1")).toBeNull();
  });
});
