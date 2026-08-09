import { describe, expect, it } from "vitest";
import {
  NORA_MAX_MESSAGE_CHARS,
  NORA_MAX_MESSAGES,
  clearNoraBrowserSession,
  loadNoraSession,
  loadPolicyCaptureHandoff,
  noraSessionKey,
  policyCaptureSessionKey,
  saveNoraSession,
  savePolicyCaptureHandoff,
  consumePolicyCaptureHandoff,
} from "@/lib/nora-browser-session";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

describe("nora browser session", () => {
  it("scopes keys to the user and rejects another user's session", () => {
    const store = storage();
    saveNoraSession("user-a", { messages: [{ id: "welcome", role: "assistant", text: "Hola" }] }, { storage: store, now: 100 });
    expect(store.values.has(noraSessionKey("user-a"))).toBe(true);
    expect(loadNoraSession("user-b", { storage: store, now: 100 })).toBeNull();
    expect(loadNoraSession("user-a", { storage: store, now: 100 })?.ownerId).toBe("user-a");
  });

  it("expires sessions and limits messages and text length", () => {
    const store = storage();
    const messages = Array.from({ length: NORA_MAX_MESSAGES + 5 }, (_, index) => ({
      id: String(index), role: "user" as const, text: "x".repeat(NORA_MAX_MESSAGE_CHARS + 100),
    }));
    saveNoraSession("user-a", { messages }, { storage: store, now: 100 });
    const loaded = loadNoraSession("user-a", { storage: store, now: 100 });
    expect(loaded?.messages).toHaveLength(NORA_MAX_MESSAGES);
    expect(loaded?.messages.every((message) => message.text.length <= NORA_MAX_MESSAGE_CHARS)).toBe(true);
    expect(loadNoraSession("user-a", { storage: store, now: 100 + 30 * 60 * 1000 + 1 })).toBeNull();
  });

  it("keeps the newest messages when the serialized session exceeds 64 KB", () => {
    const store = storage();
    const largeSection = [{
      title: "Resultados",
      summary: "x".repeat(500),
      items: Array.from({ length: 25 }, (_, index) => ({
        title: `Resultado ${index}`,
        subtitle: "x".repeat(500),
        href: `/policies/${index}`,
      })),
    }];
    const messages = Array.from({ length: 10 }, (_, index) => ({
      id: `message-${index}`,
      role: "assistant" as const,
      text: `Respuesta ${index}`,
      sections: largeSection,
    }));
    saveNoraSession("user-a", { messages }, { storage: store, now: 100 });
    const loaded = loadNoraSession("user-a", { storage: store, now: 100 });
    expect(loaded?.messages.at(-1)?.id).toBe("message-9");
    expect(loaded?.messages.some((message) => message.id === "message-0")).toBe(false);
  });

  it("keeps only safe result links and plain message fields", () => {
    const store = storage();
    saveNoraSession("user-a", {
      messages: [{
        id: "m1", role: "assistant", text: "Resultado", aiTrace: [{ secret: "no" }],
        sections: [{ title: "Clientes", summary: "ok", items: [
          { title: "Seguro", subtitle: "Cliente", href: "/policies/p1", meta: "Activo" },
          { title: "Externo", subtitle: "No", href: "https://example.com" },
        ] }],
      }],
    }, { storage: store, now: 100 });
    const loaded = loadNoraSession("user-a", { storage: store, now: 100 });
    expect(loaded?.messages[0]).toMatchObject({ id: "m1", text: "Resultado" });
    expect(loaded?.messages[0]).not.toHaveProperty("aiTrace");
    expect(loaded?.messages[0].sections?.[0].items).toHaveLength(1);
  });

  it("consumes capture handoffs once and applies their TTL", () => {
    const store = storage();
    savePolicyCaptureHandoff("user-a", { draft: { policyNumber: "P-1" }, receiptPlan: [{ amount: 10 }] }, { storage: store, now: 100 });
    expect(loadPolicyCaptureHandoff("user-a", { storage: store, now: 100 })?.payload.draft.policyNumber).toBe("P-1");
    expect(consumePolicyCaptureHandoff("user-a", { storage: store, now: 100 })?.payload.draft.policyNumber).toBe("P-1");
    expect(loadPolicyCaptureHandoff("user-a", { storage: store, now: 100 })).toBeNull();
    savePolicyCaptureHandoff("user-a", { draft: { policyNumber: "P-2" } }, { storage: store, now: 100 });
    expect(loadPolicyCaptureHandoff("user-a", { storage: store, now: 100 + 15 * 60 * 1000 + 1 })).toBeNull();
  });

  it("persists AI review, warnings, provenance, and run folios through the capture handoff", () => {
    const store = storage();
    savePolicyCaptureHandoff("user-a", {
      draft: { policyNumber: "1009578", clientName: "CLIENTE DEMO" },
      warnings: ["No encontramos póliza origen"],
      aiReview: {
        summary: "La vigencia requiere confirmación.",
        warnings: ["Confirma la fecha final."],
        suggestions: ["Revisa el origen."],
        corrections: [{ field: "endDate", proposedValue: "2027-08-01", reason: "Detectada en la carátula.", confidence: "high" }],
      },
      provenance: {
        requestedMode: "ai",
        extractionSource: "local",
        reviewSource: "ai",
        aiRunIds: ["run-review-1", "run-review-2"],
        trackingStatus: "recorded",
        aiAttempted: true,
        storageStatus: "retained",
        storageErrorCode: null,
        uploadAttemptCount: 1,
        uploadRetryable: false,
      },
      pdfReference: { url: "https://blob.test/policydesk/nora-policy-pdf/user-a/p.pdf", fileName: "p.pdf", expiresAt: 1_800_100 },
      receiptEvidence: {
        policyNumber: "0940457241",
        receiptControlNumber: "0307563244",
        dueDate: "2026-08-30",
        periodLabel: "01/01",
        amountDue: 6359.33,
        depositAmount: 6359,
        currency: "MXN",
        paymentMethod: "CONTADO",
        paymentConfirmed: false,
        warnings: ["Diferencia de centavos"],
      },
      relatedDocuments: [{ id: "doc-1", fileName: "recibo.pdf", kind: "receipt", source: "local", policyNumber: "0940457241", warnings: [] }],
    }, { storage: store, now: 100 });

    expect(loadPolicyCaptureHandoff("user-a", { storage: store, now: 100 } )?.payload).toMatchObject({
      warnings: ["No encontramos póliza origen"],
      aiReview: { summary: "La vigencia requiere confirmación.", corrections: [{ field: "endDate", proposedValue: "2027-08-01" }] },
      provenance: { requestedMode: "ai", extractionSource: "local", reviewSource: "ai", aiRunIds: ["run-review-1", "run-review-2"], trackingStatus: "recorded", aiAttempted: true, storageStatus: "retained", uploadAttemptCount: 1, uploadRetryable: false },
      pdfReference: { fileName: "p.pdf" },
      receiptEvidence: { receiptControlNumber: "0307563244" },
      relatedDocuments: [{ id: "doc-1", kind: "receipt" }],
    });
  });

  it("clears scoped and legacy keys on logout", () => {
    const store = storage();
    saveNoraSession("user-a", { messages: [{ id: "m", role: "user", text: "Hola" }] }, { storage: store, now: 100 });
    savePolicyCaptureHandoff("user-a", { draft: { policyNumber: "P-1" } }, { storage: store, now: 100 });
    store.setItem("policydesk.nora.conversation.v1", "legacy");
    clearNoraBrowserSession("user-a", { storage: store });
    expect(store.values.has(noraSessionKey("user-a"))).toBe(false);
    expect(store.values.has(policyCaptureSessionKey("user-a"))).toBe(false);
    expect(store.values.has("policydesk.nora.conversation.v1")).toBe(false);
  });

  it("continues in memory when the browser storage adapter throws", () => {
    const failingStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => undefined,
    };
    expect(saveNoraSession("user-memory", { messages: [{ id: "m", role: "user", text: "Hola" }] }, { storage: failingStorage })).toBe(true);
    expect(loadNoraSession("user-memory", { storage: failingStorage })?.messages[0]?.text).toBe("Hola");
  });
});
