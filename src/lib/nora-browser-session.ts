"use client";

import type { NoraContextRef } from "@/lib/nora-context";
import type {
  PolicyPdfCaptureAiReview,
  PolicyPdfCaptureFieldKey,
  PolicyPdfCaptureReceiptEvidence,
  PolicyPdfCaptureRelatedDocument,
  PolicyPdfCaptureProvenance,
  PolicyPdfCaptureExistingPolicyMatch,
} from "@/lib/policy-pdf-capture.shared";

export const NORA_BROWSER_SESSION_VERSION = 2 as const;
export const POLICY_CAPTURE_SESSION_VERSION = 5 as const;
export const NORA_SESSION_TTL_MS = 30 * 60 * 1000;
export const POLICY_CAPTURE_TTL_MS = 15 * 60 * 1000;
export const NORA_MAX_MESSAGES = 20;
export const NORA_MAX_MESSAGE_CHARS = 2_000;
export const NORA_MAX_SESSION_BYTES = 64 * 1024;
export const NORA_SESSION_EVENT = "policydesk:nora-session-updated";

const NORA_KEY_PREFIX = "policydesk.nora.session.v2:";
const CAPTURE_INDEX_KEY_PREFIX = "policydesk.policyCapture.index.v5:";
const CAPTURE_ITEM_KEY_PREFIX = "policydesk.policyCapture.v5:";
const LEGACY_CAPTURE_KEY_PREFIX = "policydesk.policyCapture.v4:";
const LEGACY_KEYS = [
  "policydesk.nora.conversation.v1",
  "policydesk.policyPdfCapture.v2",
  "policydesk.policyPdfCapture.v1",
];

export type NoraStorageMode = "persistent" | "memory";

const memoryNoraSessions = new Map<string, PersistedNoraSession>();
const memoryPolicyCaptureHandoffs = new Map<string, Map<string, PersistedPolicyCaptureHandoff>>();
let lastStorageMode: NoraStorageMode = "persistent";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type PersistedNoraSectionItem = {
  title: string;
  subtitle: string;
  href: string;
  meta?: string;
};

export type PersistedNoraSection = {
  title: string;
  summary: string;
  items: PersistedNoraSectionItem[];
};

export type PersistedNoraMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sections?: PersistedNoraSection[];
  capture?: {
    handoffId: string;
    fileName: string;
    fileKey?: string;
  };
};

export type PersistedNoraSession = {
  version: typeof NORA_BROWSER_SESSION_VERSION;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  input: string;
  context: NoraContextRef | null;
  activeCaptureHandoffId?: string | null;
  messages: PersistedNoraMessage[];
};

export type PolicyCaptureHandoffPayload = {
  handoffId?: string;
  draft: Record<string, unknown>;
  fieldConfidence?: Record<string, "high" | "medium" | "low">;
  selectedClientId?: string;
  selectedClientLabel?: string;
  selectedInsurerId?: string;
  selectedInsurerLabel?: string;
  selectedSourcePolicyId?: string;
  selectedSourcePolicyLabel?: string;
  showInlineClient?: boolean;
  receiptPlan?: Array<Record<string, unknown>>;
  warnings?: string[];
  aiReview?: PolicyPdfCaptureAiReview | null;
  provenance?: PolicyPdfCaptureProvenance;
  receiptEvidence?: PolicyPdfCaptureReceiptEvidence | null;
  relatedDocuments?: PolicyPdfCaptureRelatedDocument[];
  existingPolicyMatches?: PolicyPdfCaptureExistingPolicyMatch[];
  pdfReference?: {
    url: string;
    fileName: string;
    expiresAt: number;
  };
};

export type PersistedPolicyCaptureHandoff = {
  version: typeof POLICY_CAPTURE_SESSION_VERSION;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
  payload: PolicyCaptureHandoffPayload;
};

function validOwnerId(userId: string) {
  return typeof userId === "string" && userId.trim().length > 0 && userId.length <= 160;
}

function scopedKey(prefix: string, userId: string) {
  return `${prefix}${encodeURIComponent(userId)}`;
}

export function noraSessionKey(userId: string) {
  return scopedKey(NORA_KEY_PREFIX, userId);
}

export function policyCaptureSessionKey(userId: string) {
  return scopedKey(CAPTURE_INDEX_KEY_PREFIX, userId);
}

export function policyCaptureHandoffKey(userId: string, handoffId: string) {
  return `${scopedKey(CAPTURE_ITEM_KEY_PREFIX, userId)}:${encodeURIComponent(handoffId)}`;
}

function legacyPolicyCaptureSessionKey(userId: string) {
  return scopedKey(LEGACY_CAPTURE_KEY_PREFIX, userId);
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function persistenceEnabled() {
  return typeof process === "undefined"
    || (process.env.NEXT_PUBLIC_NORA_SESSION_PERSISTENCE !== "false" && process.env.NEXT_PUBLIC_NORA_SESSION_PERSISTENCE !== "0");
}

function resolveStorage(options: { storage?: StorageLike | null }) {
  if (Object.prototype.hasOwnProperty.call(options, "storage")) return options.storage ?? null;
  if (!persistenceEnabled()) return null;
  return browserStorage();
}

export function getNoraStorageMode() {
  return lastStorageMode;
}

function safeJsonSize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    return typeof TextEncoder === "undefined"
      ? serialized.length
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cleanText(value: unknown, maxChars = NORA_MAX_MESSAGE_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function safeHref(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}

function cleanContext(value: unknown): NoraContextRef | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; id?: unknown };
  const allowed = ["client", "policy", "receipt", "workItem", "claim", "endorsement"];
  if (typeof candidate.type !== "string" || !allowed.includes(candidate.type) || typeof candidate.id !== "string") return null;
  const id = candidate.id.trim();
  return id && id.length <= 100 ? { type: candidate.type as NoraContextRef["type"], id } : null;
}

function cleanSections(value: unknown): PersistedNoraSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sections = value.flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const candidate = section as { title?: unknown; summary?: unknown; items?: unknown };
    const items = Array.isArray(candidate.items)
      ? candidate.items.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as { title?: unknown; subtitle?: unknown; href?: unknown; meta?: unknown };
          const href = safeHref(row.href);
          const title = cleanText(row.title, 300);
          if (!href || !title) return [];
          return [{
            title,
            subtitle: cleanText(row.subtitle, 500),
            href,
            ...(typeof row.meta === "string" && row.meta.trim() ? { meta: cleanText(row.meta, 120) } : {}),
          }];
        })
      : [];
    return [{
      title: cleanText(candidate.title, 200),
      summary: cleanText(candidate.summary, 500),
      items: items.slice(0, 25),
    }];
  });
  return sections.slice(0, 8);
}

function cleanCaptureReference(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { handoffId?: unknown; fileName?: unknown; fileKey?: unknown };
  if (typeof candidate.handoffId !== "string" || typeof candidate.fileName !== "string") return undefined;
  const handoffId = candidate.handoffId.trim();
  const fileName = candidate.fileName.trim();
  if (!handoffId || !fileName || handoffId.length > 160 || fileName.length > 255) return undefined;
  return {
    handoffId,
    fileName,
    ...(typeof candidate.fileKey === "string" && candidate.fileKey.trim() && candidate.fileKey.length <= 300
      ? { fileKey: candidate.fileKey.trim() }
      : {}),
  };
}

function cleanMessage(value: unknown, index: number): PersistedNoraMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { id?: unknown; role?: unknown; text?: unknown; sections?: unknown; capture?: unknown };
  if (candidate.role !== "user" && candidate.role !== "assistant") return null;
  const text = cleanText(candidate.text);
  if (!text) return null;
  const capture = cleanCaptureReference(candidate.capture);
  return {
    id: cleanText(candidate.id, 120) || `message-${index}`,
    role: candidate.role,
    text,
    // Capture cards are rebuilt from the opaque handoff reference. Do not put
    // policy/client labels or extracted data into browser session storage.
    ...(!capture && cleanSections(candidate.sections) ? { sections: cleanSections(candidate.sections) } : {}),
    ...(capture ? { capture } : {}),
  };
}

export function sanitizeNoraMessages(messages: unknown, welcome?: PersistedNoraMessage) {
  const cleaned = Array.isArray(messages)
    ? messages.flatMap((message, index) => {
        const next = cleanMessage(message, index);
        return next ? [next] : [];
      })
    : [];
  const withWelcome = welcome && !cleaned.some((message) => message.id === welcome.id)
    ? [welcome, ...cleaned]
    : cleaned;
  return withWelcome.slice(-NORA_MAX_MESSAGES);
}

function parseStored<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    try { storage.removeItem(key); } catch { /* memory-only fallback */ }
    return null;
  }
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function loadNoraSession(userId: string, options: { storage?: StorageLike | null; now?: number } = {}) {
  if (!validOwnerId(userId)) return null;
  const storage = resolveStorage(options);
  const stored = parseStored<Partial<PersistedNoraSession>>(storage, noraSessionKey(userId));
  const memoryStored = memoryNoraSessions.get(userId);
  const candidate = stored ?? memoryStored;
  const now = options.now ?? Date.now();
  const expiresAt = candidate?.expiresAt;
  if (!candidate || candidate.version !== NORA_BROWSER_SESSION_VERSION || candidate.ownerId !== userId || !isValidTimestamp(expiresAt) || expiresAt <= now) {
    if (candidate) clearNoraSession(userId, { storage });
    return null;
  }
  const createdAt = candidate.createdAt;
  const updatedAt = candidate.updatedAt;
  const messages = sanitizeNoraMessages(candidate.messages);
  if (!messages.length) {
    clearNoraSession(userId, { storage });
    return null;
  }
  return {
    version: NORA_BROWSER_SESSION_VERSION,
    ownerId: userId,
    createdAt: isValidTimestamp(createdAt) ? createdAt : now,
    updatedAt: isValidTimestamp(updatedAt) ? updatedAt : now,
    expiresAt,
    input: cleanText(candidate.input, NORA_MAX_MESSAGE_CHARS),
    context: cleanContext(candidate.context),
    ...(typeof candidate.activeCaptureHandoffId === "string" && candidate.activeCaptureHandoffId.trim()
      ? { activeCaptureHandoffId: cleanText(candidate.activeCaptureHandoffId, 160) }
      : {}),
    messages,
  } satisfies PersistedNoraSession;
}

export function saveNoraSession(
  userId: string,
  value: { messages: unknown; input?: unknown; context?: unknown; activeCaptureHandoffId?: string | null; welcome?: PersistedNoraMessage },
  options: { storage?: StorageLike | null; now?: number; sourceId?: string } = {},
) {
  if (!validOwnerId(userId)) return false;
  const storage = resolveStorage(options);
  const now = options.now ?? Date.now();
  const previous = loadNoraSession(userId, { storage, now });
  const messages = sanitizeNoraMessages(value.messages, value.welcome);
  if (!messages.length) return false;
  const session: PersistedNoraSession = {
    version: NORA_BROWSER_SESSION_VERSION,
    ownerId: userId,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + NORA_SESSION_TTL_MS,
    input: cleanText(value.input, NORA_MAX_MESSAGE_CHARS),
    context: cleanContext(value.context),
    ...(value.activeCaptureHandoffId ? { activeCaptureHandoffId: cleanText(value.activeCaptureHandoffId, 160) } : {}),
    messages,
  };
  const welcomeIndex = session.messages[0]?.id === "welcome" ? 1 : 0;
  while (session.messages.length > 1 && safeJsonSize(session) > NORA_MAX_SESSION_BYTES) session.messages.splice(welcomeIndex, 1);
  if (safeJsonSize(session) > NORA_MAX_SESSION_BYTES) {
    session.messages = session.messages.map((message) => {
      const compactMessage = { ...message };
      delete compactMessage.sections;
      return compactMessage;
    });
  }
  if (safeJsonSize(session) > NORA_MAX_SESSION_BYTES) return false;
  memoryNoraSessions.set(userId, session);
  if (!storage) {
    lastStorageMode = "memory";
  } else {
    try {
      storage.setItem(noraSessionKey(userId), JSON.stringify(session));
      lastStorageMode = "persistent";
    } catch {
      lastStorageMode = "memory";
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NORA_SESSION_EVENT, {
      detail: { userId, updatedAt: session.updatedAt, sourceId: options.sourceId ?? null },
    }));
  }
  return true;
}

export function clearNoraSession(userId: string, options: { storage?: StorageLike | null } = {}) {
  if (!validOwnerId(userId)) return;
  const storage = resolveStorage(options);
  memoryNoraSessions.delete(userId);
  try { storage?.removeItem(noraSessionKey(userId)); } catch { /* memory-only fallback */ }
}

function sanitizeCapturePayload(value: unknown): PolicyCaptureHandoffPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as PolicyCaptureHandoffPayload;
  if (!candidate.draft || typeof candidate.draft !== "object" || Array.isArray(candidate.draft)) return null;
  const draftKeys = new Set([
    "policyNumber", "clientName", "clientType", "clientEmail", "clientPhone", "clientAddress", "clientRfc",
    "clientBirthDate", "insurerName", "policyType", "serialNumber", "startDate", "endDate", "issueDate",
    "paymentFrequency", "paymentPlan", "premiumAmount", "currency", "requestNumber", "insuredObject",
    "beneficiaryInfo", "notes", "sourcePolicyNumber",
  ]);
  const safeDraft = Object.fromEntries(Object.entries(candidate.draft).filter(([key, entry]) => {
    if (!draftKeys.has(key)) return false;
    if (typeof entry === "string") return entry.length <= 1_000;
    return typeof entry === "number" || entry === null;
  }));
  const safeConfidence = candidate.fieldConfidence
    ? Object.fromEntries(Object.entries(candidate.fieldConfidence).flatMap(([key, entry]) => entry === "high" || entry === "medium" || entry === "low" ? [[key, entry]] : []))
    : undefined;
  const safeReceiptPlan = Array.isArray(candidate.receiptPlan)
    ? candidate.receiptPlan.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.receiptNumber !== "string" || typeof row.periodStartDate !== "string" || typeof row.periodEndDate !== "string" || typeof row.dueDate !== "string" || typeof row.amount !== "number" || typeof row.currency !== "string") return [];
        return [{ receiptNumber: row.receiptNumber.slice(0, 120), periodStartDate: row.periodStartDate.slice(0, 20), periodEndDate: row.periodEndDate.slice(0, 20), dueDate: row.dueDate.slice(0, 20), amount: row.amount, currency: row.currency.slice(0, 10) }];
      }).slice(0, 25)
    : undefined;
  const safeWarnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.flatMap((warning) => typeof warning === "string" && warning.trim() ? [cleanText(warning, 500)] : []).slice(0, 20)
    : undefined;
  const captureFieldKeys = new Set<PolicyPdfCaptureFieldKey>([
    "policyNumber", "clientName", "clientType", "clientEmail", "clientPhone", "clientAddress", "clientRfc",
    "clientBirthDate", "insurerName", "policyType", "serialNumber", "startDate", "endDate", "issueDate",
    "paymentFrequency", "premiumAmount", "sourcePolicyNumber",
  ]);
  const rawAiReview = candidate.aiReview && typeof candidate.aiReview === "object"
    ? candidate.aiReview as unknown as Record<string, unknown>
    : null;
  const safeAiReview = rawAiReview && typeof rawAiReview.summary === "string"
    ? {
        summary: cleanText(rawAiReview.summary, 1_200),
        warnings: Array.isArray(rawAiReview.warnings)
          ? rawAiReview.warnings.flatMap((warning) => typeof warning === "string" && warning.trim() ? [cleanText(warning, 500)] : []).slice(0, 20)
          : [],
        suggestions: Array.isArray(rawAiReview.suggestions)
          ? rawAiReview.suggestions.flatMap((suggestion) => typeof suggestion === "string" && suggestion.trim() ? [cleanText(suggestion, 500)] : []).slice(0, 20)
          : [],
        corrections: Array.isArray(rawAiReview.corrections)
          ? rawAiReview.corrections.flatMap((correction) => {
              if (!correction || typeof correction !== "object") return [];
              const item = correction as Record<string, unknown>;
              const field = item.field;
              const confidence = item.confidence;
              if (
                typeof field !== "string" || !captureFieldKeys.has(field as PolicyPdfCaptureFieldKey) ||
                typeof item.proposedValue !== "string" || typeof item.reason !== "string" ||
                !["high", "medium", "low"].includes(String(confidence))
              ) return [];
              return [{
                field: field as PolicyPdfCaptureFieldKey,
                proposedValue: cleanText(item.proposedValue, 500),
                reason: cleanText(item.reason, 700),
                confidence: confidence as "high" | "medium" | "low",
              }];
            }).slice(0, 12)
          : [],
      } satisfies PolicyPdfCaptureAiReview
    : undefined;
  const rawProvenance = candidate.provenance && typeof candidate.provenance === "object"
    ? candidate.provenance as unknown as Record<string, unknown>
    : null;
  const safeProvenance = rawProvenance &&
      (rawProvenance.requestedMode === undefined || rawProvenance.requestedMode === "local" || rawProvenance.requestedMode === "ai") &&
      (rawProvenance.extractionSource === "local" || rawProvenance.extractionSource === "ai") &&
      (rawProvenance.reviewSource === "none" || rawProvenance.reviewSource === "ai") &&
      (rawProvenance.trackingStatus === "recorded" || rawProvenance.trackingStatus === "unavailable") &&
      typeof rawProvenance.aiAttempted === "boolean"
    ? {
        requestedMode: rawProvenance.requestedMode === "ai" ? "ai" : "local",
        extractionSource: rawProvenance.extractionSource,
        reviewSource: rawProvenance.reviewSource,
        aiRunIds: Array.isArray(rawProvenance.aiRunIds)
          ? rawProvenance.aiRunIds.flatMap((runId) => typeof runId === "string" && runId.trim() ? [runId.slice(0, 160)] : []).slice(0, 10)
          : [],
        trackingStatus: rawProvenance.trackingStatus,
        aiAttempted: rawProvenance.aiAttempted,
        ...(typeof rawProvenance.aiFailureCode === "string" ? { aiFailureCode: cleanText(rawProvenance.aiFailureCode, 120) } : {}),
        ...(rawProvenance.storageStatus === "pending" || rawProvenance.storageStatus === "retained" || rawProvenance.storageStatus === "unavailable" || rawProvenance.storageStatus === "retryable"
          ? { storageStatus: rawProvenance.storageStatus }
          : {}),
        ...(typeof rawProvenance.storageErrorCode === "string" ? { storageErrorCode: cleanText(rawProvenance.storageErrorCode, 120) } : {}),
        ...(typeof rawProvenance.uploadAttemptCount === "number" && Number.isInteger(rawProvenance.uploadAttemptCount) && rawProvenance.uploadAttemptCount >= 0 && rawProvenance.uploadAttemptCount <= 10
          ? { uploadAttemptCount: rawProvenance.uploadAttemptCount }
          : {}),
        ...(typeof rawProvenance.uploadRetryable === "boolean" ? { uploadRetryable: rawProvenance.uploadRetryable } : {}),
      } satisfies PolicyPdfCaptureProvenance
    : undefined;
  const safeReceiptEvidence = candidate.receiptEvidence && typeof candidate.receiptEvidence === "object"
    ? (() => {
        const row = candidate.receiptEvidence as unknown as Record<string, unknown>;
        if (row.paymentConfirmed !== false) return undefined;
        return {
          policyNumber: typeof row.policyNumber === "string" ? cleanText(row.policyNumber, 80) : null,
          receiptControlNumber: typeof row.receiptControlNumber === "string" ? cleanText(row.receiptControlNumber, 80) : null,
          dueDate: typeof row.dueDate === "string" ? cleanText(row.dueDate, 30) : null,
          periodLabel: typeof row.periodLabel === "string" ? cleanText(row.periodLabel, 30) : null,
          amountDue: typeof row.amountDue === "number" && Number.isFinite(row.amountDue) ? row.amountDue : null,
          depositAmount: typeof row.depositAmount === "number" && Number.isFinite(row.depositAmount) ? row.depositAmount : null,
          currency: typeof row.currency === "string" ? cleanText(row.currency, 10) : "MXN",
          paymentMethod: typeof row.paymentMethod === "string" ? cleanText(row.paymentMethod, 80) : null,
          paymentConfirmed: false as const,
          warnings: Array.isArray(row.warnings)
            ? row.warnings.flatMap((warning) => typeof warning === "string" && warning.trim() ? [cleanText(warning, 500)] : []).slice(0, 10)
            : [],
        } satisfies PolicyPdfCaptureReceiptEvidence;
      })()
    : undefined;
  const safeRelatedDocuments = Array.isArray(candidate.relatedDocuments)
    ? candidate.relatedDocuments.flatMap((document) => {
        if (!document || typeof document !== "object") return [];
        const row = document as unknown as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.fileName !== "string" || !["policy", "receipt", "endorsement", "inciso", "unknown"].includes(String(row.kind)) || !["local", "ai"].includes(String(row.source))) return [];
        return [{
          id: cleanText(row.id, 160),
          fileName: cleanText(row.fileName, 255),
          kind: row.kind as PolicyPdfCaptureRelatedDocument["kind"],
          source: row.source as PolicyPdfCaptureRelatedDocument["source"],
          policyNumber: typeof row.policyNumber === "string" ? cleanText(row.policyNumber, 80) : null,
          warnings: Array.isArray(row.warnings) ? row.warnings.flatMap((warning) => typeof warning === "string" && warning.trim() ? [cleanText(warning, 500)] : []).slice(0, 10) : [],
        } satisfies PolicyPdfCaptureRelatedDocument];
      }).slice(0, 20)
    : undefined;
  const safeExistingPolicyMatches = Array.isArray(candidate.existingPolicyMatches)
    ? candidate.existingPolicyMatches.flatMap((match) => {
        if (!match || typeof match !== "object") return [];
        const row = match as unknown as Record<string, unknown>;
        if (
          typeof row.id !== "string" ||
          typeof row.policyNumber !== "string" ||
          typeof row.clientName !== "string" ||
          typeof row.insurerName !== "string" ||
          typeof row.startDate !== "string" ||
          typeof row.endDate !== "string" ||
          typeof row.status !== "string" ||
          !["policyNumber", "serialNumber"].includes(String(row.matchReason))
        ) return [];
        return [{
          id: cleanText(row.id, 160),
          policyNumber: cleanText(row.policyNumber, 80),
          clientName: cleanText(row.clientName, 255),
          insurerName: cleanText(row.insurerName, 255),
          startDate: cleanText(row.startDate, 30),
          endDate: cleanText(row.endDate, 30),
          status: cleanText(row.status, 40),
          serialNumber: typeof row.serialNumber === "string" ? cleanText(row.serialNumber, 40) : null,
          matchReason: row.matchReason as PolicyPdfCaptureExistingPolicyMatch["matchReason"],
          ...(Array.isArray(row.differences)
            ? { differences: row.differences.flatMap((difference) => typeof difference === "string" && difference.trim() ? [cleanText(difference, 500)] : []).slice(0, 20) }
            : {}),
        } satisfies PolicyPdfCaptureExistingPolicyMatch];
      }).slice(0, 20)
    : undefined;
  return {
    draft: safeDraft,
    ...(typeof candidate.handoffId === "string" && candidate.handoffId.trim()
      ? { handoffId: cleanText(candidate.handoffId, 160) }
      : {}),
    ...(safeConfidence ? { fieldConfidence: safeConfidence } : {}),
    ...Object.fromEntries(["selectedClientId", "selectedClientLabel", "selectedInsurerId", "selectedInsurerLabel", "selectedSourcePolicyId", "selectedSourcePolicyLabel"].flatMap((key) => typeof candidate[key as keyof PolicyCaptureHandoffPayload] === "string" ? [[key, cleanText(candidate[key as keyof PolicyCaptureHandoffPayload], 300)]] : [])),
    ...(typeof candidate.showInlineClient === "boolean" ? { showInlineClient: candidate.showInlineClient } : {}),
    ...(safeReceiptPlan ? { receiptPlan: safeReceiptPlan } : {}),
    ...(safeWarnings ? { warnings: safeWarnings } : {}),
    ...(safeAiReview ? { aiReview: safeAiReview } : candidate.aiReview === null ? { aiReview: null } : {}),
    ...(safeProvenance ? { provenance: safeProvenance } : {}),
    ...(safeReceiptEvidence ? { receiptEvidence: safeReceiptEvidence } : candidate.receiptEvidence === null ? { receiptEvidence: null } : {}),
    ...(safeRelatedDocuments ? { relatedDocuments: safeRelatedDocuments } : {}),
    ...(safeExistingPolicyMatches ? { existingPolicyMatches: safeExistingPolicyMatches } : {}),
    ...(candidate.pdfReference && typeof candidate.pdfReference === "object" && typeof candidate.pdfReference.url === "string" && typeof candidate.pdfReference.fileName === "string" && typeof candidate.pdfReference.expiresAt === "number"
      ? { pdfReference: { url: candidate.pdfReference.url.slice(0, 2_000), fileName: cleanText(candidate.pdfReference.fileName, 255), expiresAt: candidate.pdfReference.expiresAt } }
      : {}),
  };
}

type CaptureStorageOptions = { storage?: StorageLike | null; now?: number };

function createHandoffId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function memoryHandoffsFor(userId: string) {
  let handoffs = memoryPolicyCaptureHandoffs.get(userId);
  if (!handoffs) {
    handoffs = new Map();
    memoryPolicyCaptureHandoffs.set(userId, handoffs);
  }
  return handoffs;
}

function readHandoffIds(storage: StorageLike | null, userId: string) {
  const stored = parseStored<unknown>(storage, policyCaptureSessionKey(userId));
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((id) => typeof id === "string" && id.trim() ? [id.trim().slice(0, 160)] : []).slice(0, NORA_MAX_MESSAGES);
}

function writeHandoffIds(storage: StorageLike, userId: string, ids: string[]) {
  storage.setItem(policyCaptureSessionKey(userId), JSON.stringify(Array.from(new Set(ids)).slice(0, NORA_MAX_MESSAGES)));
}

function normalizeHandoff(candidate: Partial<PersistedPolicyCaptureHandoff> | null, userId: string, now: number) {
  if (!candidate || (candidate.version !== POLICY_CAPTURE_SESSION_VERSION && candidate.version !== 4) || candidate.ownerId !== userId || !isValidTimestamp(candidate.expiresAt) || candidate.expiresAt <= now) return null;
  const payload = sanitizeCapturePayload(candidate.payload);
  if (!payload) return null;
  const handoffId = payload.handoffId ?? createHandoffId();
  return {
    version: POLICY_CAPTURE_SESSION_VERSION,
    ownerId: userId,
    createdAt: isValidTimestamp(candidate.createdAt) ? candidate.createdAt : now,
    expiresAt: candidate.expiresAt,
    payload: { ...payload, handoffId },
  } satisfies PersistedPolicyCaptureHandoff;
}

function captureOptions(handoffIdOrOptions?: string | CaptureStorageOptions, options: CaptureStorageOptions = {}) {
  return typeof handoffIdOrOptions === "string"
    ? { handoffId: handoffIdOrOptions, options }
    : { handoffId: undefined, options: handoffIdOrOptions ?? options };
}

export function savePolicyCaptureHandoff(userId: string, payload: PolicyCaptureHandoffPayload, options: CaptureStorageOptions = {}) {
  if (!validOwnerId(userId)) return false;
  const storage = resolveStorage(options);
  const safePayload = sanitizeCapturePayload({ ...payload, handoffId: payload.handoffId || createHandoffId() });
  if (!safePayload?.handoffId) return false;
  const now = options.now ?? Date.now();
  const previous = memoryHandoffsFor(userId).get(safePayload.handoffId);
  const handoff: PersistedPolicyCaptureHandoff = {
    version: POLICY_CAPTURE_SESSION_VERSION,
    ownerId: userId,
    createdAt: previous?.createdAt ?? now,
    expiresAt: now + POLICY_CAPTURE_TTL_MS,
    payload: safePayload,
  };
  memoryHandoffsFor(userId).set(safePayload.handoffId, handoff);
  if (!storage) {
    lastStorageMode = "memory";
    return true;
  }
  try {
    const ids = readHandoffIds(storage, userId).filter((id) => id !== safePayload.handoffId);
    writeHandoffIds(storage, userId, [safePayload.handoffId, ...ids]);
    lastStorageMode = "persistent";
    return true;
  } catch {
    lastStorageMode = "memory";
    return true;
  }
}

export function listPolicyCaptureHandoffs(userId: string, options: CaptureStorageOptions = {}) {
  if (!validOwnerId(userId)) return [];
  const storage = resolveStorage(options);
  const now = options.now ?? Date.now();
  const memory = memoryHandoffsFor(userId);
  const ids = [...new Set([...readHandoffIds(storage, userId), ...memory.keys()])];
  return ids.flatMap((id) => {
    const stored = parseStored<Partial<PersistedPolicyCaptureHandoff>>(storage, policyCaptureHandoffKey(userId, id));
    // The browser stores only the opaque ID. Full handoff contents live in memory
    // during the current SPA session or in the private server-side temporary store.
    const candidate = normalizeHandoff(memory.get(id) ?? stored ?? null, userId, now);
    if (!candidate) {
      clearPolicyCaptureHandoff(userId, id, { storage });
      return [];
    }
    memory.set(id, candidate);
    return [candidate];
  });
}

export function loadPolicyCaptureHandoff(userId: string, handoffIdOrOptions?: string | CaptureStorageOptions, options: CaptureStorageOptions = {}) {
  if (!validOwnerId(userId)) return null;
  const parsed = captureOptions(handoffIdOrOptions, options);
  const handoffs = listPolicyCaptureHandoffs(userId, parsed.options);
  if (parsed.handoffId) return handoffs.find((handoff) => handoff.payload.handoffId === parsed.handoffId) ?? null;
  if (handoffs.length > 0) return handoffs[0] ?? null;

  // One-time compatibility for the previous single-handoff browser format.
  const storage = resolveStorage(parsed.options);
  const legacy = normalizeHandoff(parseStored<Partial<PersistedPolicyCaptureHandoff>>(storage, legacyPolicyCaptureSessionKey(userId)), userId, parsed.options.now ?? Date.now());
  if (legacy && (!parsed.handoffId || legacy.payload.handoffId === parsed.handoffId)) {
    memoryHandoffsFor(userId).set(legacy.payload.handoffId!, legacy);
    return legacy;
  }
  return null;
}

export function consumePolicyCaptureHandoff(userId: string, handoffIdOrOptions?: string | CaptureStorageOptions, options: CaptureStorageOptions = {}) {
  const parsed = captureOptions(handoffIdOrOptions, options);
  const result = parsed.handoffId
    ? loadPolicyCaptureHandoff(userId, parsed.handoffId, parsed.options)
    : loadPolicyCaptureHandoff(userId, parsed.options);
  if (result) clearPolicyCaptureHandoff(userId, result.payload.handoffId, parsed.options);
  return result;
}

export function clearPolicyCaptureHandoff(userId: string, handoffIdOrOptions?: string | CaptureStorageOptions, options: CaptureStorageOptions = {}) {
  if (!validOwnerId(userId)) return;
  const parsed = captureOptions(handoffIdOrOptions, options);
  const storage = resolveStorage(parsed.options);
  const memory = memoryHandoffsFor(userId);
  if (parsed.handoffId) {
    memory.delete(parsed.handoffId);
    try {
      storage?.removeItem(policyCaptureHandoffKey(userId, parsed.handoffId));
      const ids = readHandoffIds(storage, userId).filter((id) => id !== parsed.handoffId);
      if (storage) writeHandoffIds(storage, userId, ids);
    } catch { /* best effort cleanup */ }
    return;
  }
  memoryPolicyCaptureHandoffs.delete(userId);
  try {
    for (const id of readHandoffIds(storage, userId)) storage?.removeItem(policyCaptureHandoffKey(userId, id));
    storage?.removeItem(policyCaptureSessionKey(userId));
    storage?.removeItem(legacyPolicyCaptureSessionKey(userId));
  } catch { /* memory-only fallback */ }
}

export function clearNoraBrowserSession(userId: string, options: { storage?: StorageLike | null } = {}) {
  const storage = resolveStorage(options);
  clearNoraSession(userId, { storage });
  clearPolicyCaptureHandoff(userId, { storage });
  if (!storage) return;
  for (const key of LEGACY_KEYS) {
    try { storage.removeItem(key); } catch { /* best effort */ }
  }
}

export async function persistPolicyCaptureHandoff(userId: string, payload: PolicyCaptureHandoffPayload) {
  const saved = savePolicyCaptureHandoff(userId, payload);
  if (!saved || typeof fetch === "undefined") return saved;
  const handoff = loadPolicyCaptureHandoff(userId, payload.handoffId);
  const handoffId = handoff?.payload.handoffId ?? payload.handoffId;
  if (!handoffId) return false;
  try {
    const response = await fetch("/api/nora/policy-pdf/handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffId, payload: { ...payload, handoffId } }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function restorePolicyCaptureHandoff(userId: string, handoffId: string) {
  if (!validOwnerId(userId) || !handoffId || typeof fetch === "undefined") return null;
  try {
    const response = await fetch(`/api/nora/policy-pdf/handoff?handoffId=${encodeURIComponent(handoffId)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { handoff?: Partial<PersistedPolicyCaptureHandoff> };
    const normalized = normalizeHandoff(body.handoff ?? null, userId, Date.now());
    if (!normalized) return null;
    memoryHandoffsFor(userId).set(handoffId, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function deletePolicyCaptureHandoffRemote(handoffId: string) {
  if (!handoffId || typeof fetch === "undefined") return;
  try {
    await fetch(`/api/nora/policy-pdf/handoff?handoffId=${encodeURIComponent(handoffId)}`, { method: "DELETE", keepalive: true });
  } catch {
    // TTL cleanup remains the server-side fallback.
  }
}

export function cleanupLegacyNoraState(options: { storage?: StorageLike | null } = {}) {
  const storage = options.storage ?? browserStorage();
  if (!storage) return;
  for (const key of LEGACY_KEYS) {
    try { storage.removeItem(key); } catch { /* best effort */ }
  }
}
