"use client";

import type { NoraContextRef } from "@/lib/nora-context";
import type {
  PolicyPdfCaptureAiReview,
  PolicyPdfCaptureFieldKey,
  PolicyPdfCaptureReceiptEvidence,
  PolicyPdfCaptureRelatedDocument,
  PolicyPdfCaptureProvenance,
} from "@/lib/policy-pdf-capture.shared";

export const NORA_BROWSER_SESSION_VERSION = 2 as const;
export const POLICY_CAPTURE_SESSION_VERSION = 4 as const;
export const NORA_SESSION_TTL_MS = 30 * 60 * 1000;
export const POLICY_CAPTURE_TTL_MS = 15 * 60 * 1000;
export const NORA_MAX_MESSAGES = 20;
export const NORA_MAX_MESSAGE_CHARS = 2_000;
export const NORA_MAX_SESSION_BYTES = 64 * 1024;
export const NORA_SESSION_EVENT = "policydesk:nora-session-updated";

const NORA_KEY_PREFIX = "policydesk.nora.session.v2:";
const CAPTURE_KEY_PREFIX = "policydesk.policyCapture.v4:";
const LEGACY_KEYS = [
  "policydesk.nora.conversation.v1",
  "policydesk.policyPdfCapture.v2",
  "policydesk.policyPdfCapture.v1",
];

export type NoraStorageMode = "persistent" | "memory";

const memoryNoraSessions = new Map<string, PersistedNoraSession>();
const memoryPolicyCaptureHandoffs = new Map<string, PersistedPolicyCaptureHandoff>();
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
};

export type PersistedNoraSession = {
  version: typeof NORA_BROWSER_SESSION_VERSION;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  input: string;
  context: NoraContextRef | null;
  messages: PersistedNoraMessage[];
};

export type PolicyCaptureHandoffPayload = {
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
  return scopedKey(CAPTURE_KEY_PREFIX, userId);
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

function cleanMessage(value: unknown, index: number): PersistedNoraMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { id?: unknown; role?: unknown; text?: unknown; sections?: unknown };
  if (candidate.role !== "user" && candidate.role !== "assistant") return null;
  const text = cleanText(candidate.text);
  if (!text) return null;
  return {
    id: cleanText(candidate.id, 120) || `message-${index}`,
    role: candidate.role,
    text,
    ...(cleanSections(candidate.sections) ? { sections: cleanSections(candidate.sections) } : {}),
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
    messages,
  } satisfies PersistedNoraSession;
}

export function saveNoraSession(
  userId: string,
  value: { messages: unknown; input?: unknown; context?: unknown; welcome?: PersistedNoraMessage },
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
  return {
    draft: safeDraft,
    ...(safeConfidence ? { fieldConfidence: safeConfidence } : {}),
    ...Object.fromEntries(["selectedClientId", "selectedClientLabel", "selectedInsurerId", "selectedInsurerLabel", "selectedSourcePolicyId", "selectedSourcePolicyLabel"].flatMap((key) => typeof candidate[key as keyof PolicyCaptureHandoffPayload] === "string" ? [[key, cleanText(candidate[key as keyof PolicyCaptureHandoffPayload], 300)]] : [])),
    ...(typeof candidate.showInlineClient === "boolean" ? { showInlineClient: candidate.showInlineClient } : {}),
    ...(safeReceiptPlan ? { receiptPlan: safeReceiptPlan } : {}),
    ...(safeWarnings ? { warnings: safeWarnings } : {}),
    ...(safeAiReview ? { aiReview: safeAiReview } : candidate.aiReview === null ? { aiReview: null } : {}),
    ...(safeProvenance ? { provenance: safeProvenance } : {}),
    ...(safeReceiptEvidence ? { receiptEvidence: safeReceiptEvidence } : candidate.receiptEvidence === null ? { receiptEvidence: null } : {}),
    ...(safeRelatedDocuments ? { relatedDocuments: safeRelatedDocuments } : {}),
    ...(candidate.pdfReference && typeof candidate.pdfReference === "object" && typeof candidate.pdfReference.url === "string" && typeof candidate.pdfReference.fileName === "string" && typeof candidate.pdfReference.expiresAt === "number"
      ? { pdfReference: { url: candidate.pdfReference.url.slice(0, 2_000), fileName: cleanText(candidate.pdfReference.fileName, 255), expiresAt: candidate.pdfReference.expiresAt } }
      : {}),
  };
}

export function savePolicyCaptureHandoff(userId: string, payload: PolicyCaptureHandoffPayload, options: { storage?: StorageLike | null; now?: number } = {}) {
  if (!validOwnerId(userId)) return false;
  const storage = resolveStorage(options);
  const safePayload = sanitizeCapturePayload(payload);
  if (!safePayload) return false;
  const now = options.now ?? Date.now();
  const handoff: PersistedPolicyCaptureHandoff = { version: POLICY_CAPTURE_SESSION_VERSION, ownerId: userId, createdAt: now, expiresAt: now + POLICY_CAPTURE_TTL_MS, payload: safePayload };
  memoryPolicyCaptureHandoffs.set(userId, handoff);
  if (!storage) {
    lastStorageMode = "memory";
    return true;
  }
  try {
    storage.setItem(policyCaptureSessionKey(userId), JSON.stringify(handoff));
    lastStorageMode = "persistent";
    return true;
  } catch {
    lastStorageMode = "memory";
    return true;
  }
}

export function loadPolicyCaptureHandoff(userId: string, options: { storage?: StorageLike | null; now?: number } = {}) {
  if (!validOwnerId(userId)) return null;
  const storage = resolveStorage(options);
  const stored = parseStored<Partial<PersistedPolicyCaptureHandoff>>(storage, policyCaptureSessionKey(userId));
  const memoryStored = memoryPolicyCaptureHandoffs.get(userId);
  const candidate = stored ?? memoryStored;
  const now = options.now ?? Date.now();
  const expiresAt = candidate?.expiresAt;
  if (!candidate || candidate.version !== POLICY_CAPTURE_SESSION_VERSION || candidate.ownerId !== userId || !isValidTimestamp(expiresAt) || expiresAt <= now) {
    if (candidate) clearPolicyCaptureHandoff(userId, { storage });
    return null;
  }
  const payload = sanitizeCapturePayload(candidate.payload);
  if (!payload) {
    clearPolicyCaptureHandoff(userId, { storage });
    return null;
  }
  return { ...candidate, expiresAt, payload } as PersistedPolicyCaptureHandoff;
}

export function consumePolicyCaptureHandoff(userId: string, options: { storage?: StorageLike | null; now?: number } = {}) {
  const result = loadPolicyCaptureHandoff(userId, options);
  clearPolicyCaptureHandoff(userId, options);
  return result;
}

export function clearPolicyCaptureHandoff(userId: string, options: { storage?: StorageLike | null } = {}) {
  if (!validOwnerId(userId)) return;
  const storage = resolveStorage(options);
  memoryPolicyCaptureHandoffs.delete(userId);
  try { storage?.removeItem(policyCaptureSessionKey(userId)); } catch { /* memory-only fallback */ }
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

export function cleanupLegacyNoraState(options: { storage?: StorageLike | null } = {}) {
  const storage = options.storage ?? browserStorage();
  if (!storage) return;
  for (const key of LEGACY_KEYS) {
    try { storage.removeItem(key); } catch { /* best effort */ }
  }
}
