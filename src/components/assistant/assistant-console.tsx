"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowUp, Bot, Check, Clipboard, FileUp, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import type {
  AssistantAiTraceEntry,
  AssistantAiUsageSnapshot,
  AssistantConversationResponse,
  AssistantPrompt,
  AssistantSection,
  AssistantSnapshot,
} from "@/lib/assistant-types";
import type { PolicyPdfCaptureCorrectionProposal, PolicyPdfCaptureDraft, PolicyPdfCaptureFieldConfidence, PolicyPdfCapturePreview, PolicyPdfCaptureProvenance, PolicyPdfCaptureReceiptPlanItem, PolicyPdfCaptureRelatedDocument } from "@/lib/policy-pdf-capture.shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AssistantActionProposalCard } from "@/components/assistant/assistant-action-proposal-card";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { extractPdfTextFromFile } from "@/lib/pdf-text-extraction.browser";
import { buildNoraPolicyPdfPathname } from "@/lib/nora-pdf-storage.shared";
import {
  fetchPdfCaptureWithTimeout,
  PDF_CAPTURE_ANALYSIS_TIMEOUT_MS,
  PdfCaptureUploadError,
  uploadPdfWithRetry,
  type PdfCaptureUploadProgress,
} from "@/lib/pdf-capture-client";
import type { NoraContextRef } from "@/lib/nora-context";
import { NoraExcelDownload } from "@/components/assistant/nora-excel-download";
import { mergePolicyPdfFiles, PolicyPdfFilePicker } from "@/components/policies/policy-pdf-file-picker";
import { PolicyCaptureCorrectionCard } from "@/components/assistant/policy-capture-correction-card";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { cleanupLegacyNoraState, clearPolicyCaptureHandoff, deletePolicyCaptureHandoffRemote, getNoraStorageMode, loadNoraSession, loadPolicyCaptureHandoff, NORA_SESSION_EVENT, persistPolicyCaptureHandoff, restorePolicyCaptureHandoff, saveNoraSession, type NoraStorageMode, type PolicyCaptureHandoffPayload } from "@/lib/nora-browser-session";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: AssistantConversationResponse["source"];
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
  reportThemeLabel?: string | null;
  aiRunId?: string | null;
  aiTrackingStatus?: "recorded" | "unavailable";
  aiTier?: string | null;
  aiModel?: string | null;
  aiAttempts?: number;
  aiUsage?: AssistantAiUsageSnapshot | null;
  aiTrace?: AssistantAiTraceEntry[];
  aiToolTrace?: AssistantConversationResponse["aiToolTrace"];
  aiPromptVersion?: string | null;
  aiExecutionProfile?: AssistantConversationResponse["aiExecutionProfile"];
  aiStepCount?: AssistantConversationResponse["aiStepCount"];
  aiTerminationReason?: AssistantConversationResponse["aiTerminationReason"];
  aiBudgetWarning?: string | null;
  aiFallbackNotice?: string | null;
  aiDiagnostic?: AssistantConversationResponse["aiDiagnostic"];
  reportId?: string | null;
  capturePreview?: {
    fileName: string;
    fileKey?: string;
    handoffId?: string;
    provenance: PolicyPdfCaptureProvenance;
    preview: PolicyPdfCapturePreview;
    pdfReference?: { url: string; fileName: string; expiresAt: number } | null;
  };
  capture?: {
    handoffId: string;
    fileName: string;
    fileKey?: string;
  };
  captureUnavailable?: string;
  captureCorrection?: PolicyPdfCaptureCorrectionProposal | null;
  actionProposal?: AssistantConversationResponse["actionProposal"];
  todayMetrics?: AssistantConversationResponse["todayMetrics"];
};

type ActiveCapture = {
  handoffId: string;
  fileName: string;
  payload: PolicyCaptureHandoffPayload;
};

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildAssistantHistory(messages: Message[]) {
  let remaining = 6_000;
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages.filter((entry) => entry.id !== "welcome").slice(-6).reverse()) {
    if (remaining <= 0) break;
    const content = message.text.trim().slice(0, Math.min(2_000, remaining));
    if (!content) continue;
    history.unshift({ role: message.role, content });
    remaining -= content.length;
  }
  return history;
}

function initialMessage(snapshot: AssistantSnapshot): Message {
  return {
    id: "welcome",
    role: "assistant",
    text: snapshot.welcome,
    source: "local",
    quickPrompts: snapshot.quickPrompts,
  };
}

function formatDateValue(value: string | null | undefined) {
  if (!value) return "Sin dato";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatCurrencyValue(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("es-MX", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value)) return "Sin dato";
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatTokenCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX");
}

function formatCostUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.000001) return "<$0.000001";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
}

function formatUsageCost(usage: AssistantAiUsageSnapshot | null | undefined) {
  if (!usage) return "No disponible";
  const value = usage.billedCostUsd ?? usage.estimatedCostUsd;
  const suffix = usage.costSource === "gateway" ? " · Gateway" : usage.costSource === "estimated" ? " · estimado" : "";
  return `${formatCostUsd(value)}${suffix}`;
}

function buildCaptureSessionPayload(preview: PolicyPdfCapturePreview, pdfReference?: { url: string; fileName: string; expiresAt: number } | null, handoffId = makeId()): PolicyCaptureHandoffPayload {
  return {
    handoffId,
    draft: preview.draft,
    fieldConfidence: preview.fieldConfidence,
    selectedClientId: preview.suggestions.clientId ?? "",
    selectedClientLabel:
      preview.clientOptions.find((option) => option.id === preview.suggestions.clientId)?.label ?? preview.draft.clientName ?? "",
    selectedInsurerId: preview.suggestions.insurerId ?? "",
    selectedInsurerLabel:
      preview.insurerOptions.find((option) => option.id === preview.suggestions.insurerId)?.label ?? preview.draft.insurerName ?? "",
    selectedSourcePolicyId: preview.suggestions.sourcePolicyId ?? "",
    selectedSourcePolicyLabel:
      preview.sourcePolicyOptions.find((option) => option.id === preview.suggestions.sourcePolicyId)?.label ??
      preview.draft.sourcePolicyNumber ??
      "",
    showInlineClient: false,
    warnings: preview.warnings,
    aiReview: preview.aiReview,
    provenance: preview.provenance,
    receiptPlan: preview.receiptPlan,
    receiptEvidence: preview.receiptEvidence ?? null,
    relatedDocuments: preview.relatedDocuments,
    ...(pdfReference ? { pdfReference } : {}),
  };
}

function captureProvenanceLabel(provenance: PolicyPdfCaptureProvenance) {
  if (provenance.extractionSource === "ai") return "Extracción IA";
  if (provenance.reviewSource === "ai") return "Local + revisión IA";
  return "Local";
}

function captureProvenanceSource(provenance: PolicyPdfCaptureProvenance): "local" | "ai" {
  return provenance.extractionSource === "ai" || provenance.reviewSource === "ai" ? "ai" : "local";
}

function previewFromHandoffPayload(payload: PolicyCaptureHandoffPayload): PolicyPdfCapturePreview {
  const draft = payload.draft as unknown as PolicyPdfCaptureDraft;
  const fieldConfidence = (payload.fieldConfidence ?? {}) as PolicyPdfCaptureFieldConfidence;
  const receiptPlan = (payload.receiptPlan ?? []) as unknown as PolicyPdfCaptureReceiptPlanItem[];
  const provenance = payload.provenance ?? {
    requestedMode: "local" as const,
    extractionSource: "local" as const,
    reviewSource: payload.aiReview ? "ai" as const : "none" as const,
    aiRunIds: [],
    trackingStatus: "recorded" as const,
    aiAttempted: Boolean(payload.aiReview),
  };
  return {
    draft,
    suggestions: {
      clientId: payload.selectedClientId || null,
      insurerId: payload.selectedInsurerId || null,
      sourcePolicyId: payload.selectedSourcePolicyId || null,
    },
    receiptPlan,
    clientOptions: [],
    insurerOptions: [],
    sourcePolicyOptions: [],
    fieldConfidence,
    confidence: {
      client: Boolean(payload.selectedClientId),
      insurer: Boolean(payload.selectedInsurerId),
      sourcePolicy: Boolean(payload.selectedSourcePolicyId),
    },
    warnings: payload.warnings ?? [],
    aiReview: payload.aiReview ?? null,
    provenance,
    relatedDocuments: payload.relatedDocuments,
    receiptEvidence: payload.receiptEvidence ?? null,
  };
}

async function restoreNoraCaptureMessages(userId: string, messages: Message[]) {
  return Promise.all(messages.map(async (message) => {
    if (!message.capture?.handoffId) return message;
    const handoff = loadPolicyCaptureHandoff(userId, message.capture.handoffId) ?? await restorePolicyCaptureHandoff(userId, message.capture.handoffId);
    if (!handoff) {
      return {
        ...message,
        capturePreview: undefined,
        captureUnavailable: "Esta ficha de captura expiró o ya fue eliminada. Vuelve a adjuntar el PDF para continuar.",
      };
    }
    const preview = previewFromHandoffPayload(handoff.payload);
    return {
      ...message,
      captureUnavailable: undefined,
      capturePreview: {
        fileName: message.capture.fileName,
        fileKey: message.capture.fileKey,
        handoffId: handoff.payload.handoffId,
        provenance: preview.provenance,
        preview,
        pdfReference: handoff.payload.pdfReference ?? null,
      },
    };
  }));
}

function makePdfReference(url: string, fileName: string) {
  return { url, fileName, expiresAt: Date.now() + 30 * 60 * 1000 };
}

function withStorageStatus(
  preview: PolicyPdfCapturePreview,
  status: PolicyPdfCaptureProvenance["storageStatus"],
  options: { errorCode?: string | null; attempts?: number; retryable?: boolean } = {},
) {
  const warning = status === "unavailable" || status === "retryable"
    ? "No pudimos conservar temporalmente el PDF; puedes reintentar la subida antes de pedir una revisión IA."
    : null;
  return {
    ...preview,
    warnings: warning && !preview.warnings.includes(warning) ? [...preview.warnings, warning] : preview.warnings,
    provenance: {
      ...preview.provenance,
      storageStatus: status,
      storageErrorCode: options.errorCode ?? null,
      ...(options.attempts != null ? { uploadAttemptCount: options.attempts } : {}),
      ...(options.retryable != null ? { uploadRetryable: options.retryable } : {}),
    },
  } satisfies PolicyPdfCapturePreview;
}

function wantsExplicitAi(prompt: string) {
  return /\b(?:con|usando|usa|utiliza|necesito)\s+ia\b|\bia\s+(?:real|directa)\b/i.test(prompt);
}

function wantsCaptureCorrection(prompt: string) {
  return /\b(?:corrige|corregir|ajusta|ajustar|actualiza|cambia|busca|encuentra|revisa)\b/i.test(prompt) &&
    /\b(?:cliente|aseguradora|origen|anterior|serie|p[oó]liza)\b/i.test(prompt);
}

function CapturePreviewCard({
  fileName,
  provenance,
  preview,
  onOpenCapture,
  onSelectContext,
  onReanalyzeAi,
  onRetryRetention,
  compact = false,
}: {
  fileName: string;
  provenance: PolicyPdfCaptureProvenance;
  preview: PolicyPdfCapturePreview;
  onOpenCapture: () => void;
  onSelectContext?: () => void;
  onReanalyzeAi?: () => void;
  onRetryRetention?: () => void;
  compact?: boolean;
}) {
  const { draft } = preview;
  const warnings = preview.warnings.slice(0, 3);

  return (
    <div className="mt-3 overflow-hidden rounded-3xl border border-border/70 bg-background/90 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Carátula detectada</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{fileName}</p>
        </div>
        <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
          {captureProvenanceLabel(provenance)}
        </Badge>
      </div>
      <div className={cn("grid gap-3 px-4 py-4", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Póliza</p>
          <p className="mt-1 break-words text-sm font-medium">{draft.policyNumber || "Sin dato"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cliente</p>
          <p className="mt-1 break-words text-sm font-medium">{draft.clientName || "Sin dato"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Aseguradora</p>
          <p className="mt-1 text-sm font-medium">{draft.insurerName || "Sin dato"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prima</p>
          <p className="mt-1 text-sm font-medium">{formatCurrencyValue(draft.premiumAmount, draft.currency || "MXN")}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Vigencia</p>
          <p className="mt-1 text-sm font-medium">
            {formatDateValue(draft.startDate)} - {formatDateValue(draft.endDate)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Renueva</p>
          <p className="mt-1 text-sm font-medium">{draft.sourcePolicyNumber || "Sin dato"}</p>
        </div>
      </div>
      {warnings.length > 0 ? (
        <div className="border-t border-border/60 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Advertencias</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {provenance.storageStatus === "pending" ? (
        <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">Conservando temporalmente el PDF para permitir una revisión IA posterior…</p>
      ) : null}
      {provenance.storageStatus === "unavailable" || provenance.storageStatus === "retryable" ? (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          La captura local está disponible, pero el PDF no quedó conservado temporalmente.
        </div>
      ) : null}
      <div className={cn("gap-3 border-t border-border/60 px-4 py-3", compact ? "grid" : "flex items-center justify-between")}>
        <p className="text-xs text-muted-foreground">Abre la captura para revisar, ajustar y confirmar.</p>
        {onSelectContext ? (
          <Button type="button" size="sm" variant="ghost" className="rounded-full text-xs" onClick={onSelectContext}>
            Usar como contexto
          </Button>
        ) : null}
        <Button type="button" size="sm" className={cn("rounded-full", compact && "w-full")} onClick={onOpenCapture}>
          Revisar captura
        </Button>
        {onRetryRetention ? (
          <Button type="button" size="sm" variant="outline" className={cn("rounded-full", compact && "w-full")} onClick={onRetryRetention}>
            Reintentar conservación
          </Button>
        ) : null}
        {onReanalyzeAi ? (
          <Button type="button" size="sm" variant="outline" className={cn("rounded-full", compact && "w-full")} onClick={onReanalyzeAi}>
            Revisar con IA
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantConsole({
  snapshot,
  userId,
  variant = "workspace",
  context = null,
  initialPrompt,
  onHandoffReady,
  onContextChange,
  onConfirmed,
}: {
  snapshot: AssistantSnapshot;
  userId: string;
  variant?: "workspace" | "panel";
  context?: NoraContextRef | null;
  initialPrompt?: string;
  onHandoffReady?: (handoff: () => void) => void;
  onContextChange?: (context: NoraContextRef | null) => void;
  onConfirmed?: () => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [initialMessage(snapshot)]);
  const [isSending, setIsSending] = useState(false);
  const [attachedPdfs, setAttachedPdfs] = useState<File[]>([]);
  const [documentMode, setDocumentMode] = useState<"independent" | "group">("independent");
  const [activeCapture, setActiveCapture] = useState<ActiveCapture | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, { status: "pending" | "uploading" | "retained" | "unavailable" | "retryable"; progress: number; label: string; retryable: boolean }>>({});
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [activeContext, setActiveContext] = useState<NoraContextRef | null>(context);
  const [storageMode, setStorageMode] = useState<NoraStorageMode>("persistent");
  const restoredUserIdRef = useRef<string | null>(null);
  const contextInitializedRef = useRef(false);
  const instanceIdRef = useRef(makeId());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSessionUpdatedAtRef = useRef(0);
  const operationControllersRef = useRef(new Map<string, AbortController>());
  const operationFilesRef = useRef(new Map<string, string>());
  function fileOperationId(file: File) {
    const signature = `${file.name}:${file.size}:${file.lastModified}`;
    let hash = 2166136261;
    for (let index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `file_${(hash >>> 0).toString(36)}`;
  }

  function updateContext(next: NoraContextRef | null) {
    setActiveContext(next);
    onContextChange?.(next);
  }

  useEffect(() => {
    if (restoredUserIdRef.current === userId) return;
    restoredUserIdRef.current = userId;
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      try {
        cleanupLegacyNoraState();
        const stored = loadNoraSession(userId);
        if (stored?.messages.length) {
          setMessages(await restoreNoraCaptureMessages(userId, stored.messages as Message[]));
          setInput(stored.input);
          lastSessionUpdatedAtRef.current = stored.updatedAt;
          if (!context && stored.context) {
            setActiveContext(stored.context);
            onContextChange?.(stored.context);
          }
        } else if (initialPrompt) {
          setInput(initialPrompt);
        }
        const storedCapture = (stored?.activeCaptureHandoffId
          ? loadPolicyCaptureHandoff(userId, stored.activeCaptureHandoffId)
          : null) ?? loadPolicyCaptureHandoff(userId);
        const remoteCapture = storedCapture ?? (stored?.activeCaptureHandoffId ? await restorePolicyCaptureHandoff(userId, stored.activeCaptureHandoffId) : null);
        if (remoteCapture?.payload?.draft) {
          setActiveCapture({
            handoffId: remoteCapture.payload.handoffId ?? makeId(),
            fileName: remoteCapture.payload.pdfReference?.fileName ?? "captura.pdf",
            payload: remoteCapture.payload,
          });
        }
        if (variant === "workspace" && window.location.search.includes("source=panel")) {
          router.replace("/assistant", { scroll: false });
        }
      } catch {
        // Browser storage is optional; continue with in-memory state.
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [context, initialPrompt, onContextChange, router, userId, variant]);

  useEffect(() => {
    if (!sessionReady) return;
    const onSessionUpdated = async (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; updatedAt?: number; sourceId?: string }>).detail;
      if (detail?.userId !== userId || detail.sourceId === instanceIdRef.current || !detail.updatedAt || detail.updatedAt <= lastSessionUpdatedAtRef.current) return;
      const stored = loadNoraSession(userId);
      if (!stored?.messages.length) return;
      lastSessionUpdatedAtRef.current = stored.updatedAt;
      setMessages(await restoreNoraCaptureMessages(userId, stored.messages as Message[]));
      setInput(stored.input);
      if (stored.context) {
        setActiveContext(stored.context);
        onContextChange?.(stored.context);
      }
    };
    window.addEventListener(NORA_SESSION_EVENT, onSessionUpdated);
    return () => window.removeEventListener(NORA_SESSION_EVENT, onSessionUpdated);
  }, [onContextChange, sessionReady, userId]);

  const saveSession = useCallback(() => {
    const saved = saveNoraSession(userId, {
      messages,
      input,
      context: activeContext,
      activeCaptureHandoffId: activeCapture?.handoffId ?? null,
      welcome: initialMessage(snapshot),
    }, { sourceId: instanceIdRef.current });
    if (saved) {
      const stored = loadNoraSession(userId);
      if (stored) lastSessionUpdatedAtRef.current = stored.updatedAt;
    }
    return saved;
  }, [activeCapture?.handoffId, activeContext, input, messages, snapshot, userId]);

  useEffect(() => {
    if (!sessionReady) return;
    saveSession();
    queueMicrotask(() => setStorageMode(getNoraStorageMode()));
  }, [saveSession, sessionReady]);

  useEffect(() => {
    if (!onHandoffReady) return;
    onHandoffReady(() => { saveSession(); });
  }, [onHandoffReady, saveSession, sessionReady]);

  const cleanupCaptureReferences = useCallback((references?: Array<{ url: string; fileName: string; expiresAt: number }>) => {
    const referencesToClean = references ?? (() => {
      const current = messages.flatMap((message) => message.capturePreview?.pdfReference ? [message.capturePreview.pdfReference] : []);
      if (activeCapture?.payload.pdfReference) current.push(activeCapture.payload.pdfReference);
      return Array.from(new Map(current.map((reference) => [reference.url, reference])).values());
    })();
    for (const reference of referencesToClean) {
      if (reference.expiresAt > Date.now()) {
        void fetch("/api/nora/policy-pdf/cleanup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: reference.url }),
          keepalive: true,
        }).catch(() => {});
      }
    }
  }, [activeCapture, messages]);

  useEffect(() => {
    const onPageHide = () => {
      for (const controller of operationControllersRef.current.values()) controller.abort("page-hidden");
      const handoffIds = messages.flatMap((message) => message.capture?.handoffId ? [message.capture.handoffId] : []);
      if (activeCapture?.handoffId) handoffIds.push(activeCapture.handoffId);
      for (const handoffId of new Set(handoffIds)) void deletePolicyCaptureHandoffRemote(handoffId);
      cleanupCaptureReferences();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [activeCapture, cleanupCaptureReferences, messages]);

  useEffect(() => {
    if (!contextInitializedRef.current) {
      contextInitializedRef.current = true;
      return;
    }
    queueMicrotask(() => setActiveContext(context));
  }, [context]);

  useEffect(() => {
    if (!sessionReady || !initialPrompt || input.trim()) return;
    queueMicrotask(() => setInput(initialPrompt));
  }, [initialPrompt, input, sessionReady]);

  function clearAttachment() {
    const handoffIds = messages.flatMap((message) => message.capture?.handoffId ? [message.capture.handoffId] : []);
    if (activeCapture?.handoffId) handoffIds.push(activeCapture.handoffId);
    for (const handoffId of new Set(handoffIds)) void deletePolicyCaptureHandoffRemote(handoffId);
    cleanupCaptureReferences();
    for (const controller of operationControllersRef.current.values()) controller.abort("attachment-cleared");
    operationControllersRef.current.clear();
    operationFilesRef.current.clear();
    setAttachedPdfs([]);
    setUploadStates({});
    setAttachmentError(null);
    setActiveCapture(null);
    clearPolicyCaptureHandoff(userId);
  }

  function handleAttachedPdfsChange(nextFiles: File[]) {
    const nextKeys = new Set(nextFiles.map(fileOperationId));
    const removedKeys = new Set(attachedPdfs.filter((file) => !nextKeys.has(fileOperationId(file))).map(fileOperationId));
    if (removedKeys.size > 0) {
      for (const [operationId, key] of operationFilesRef.current.entries()) {
        if (removedKeys.has(key)) {
          operationControllersRef.current.get(operationId)?.abort("file-removed");
          operationControllersRef.current.delete(operationId);
          operationFilesRef.current.delete(operationId);
        }
      }
      const removedMessages = messages.filter((message) => message.capture && message.capture.fileKey && removedKeys.has(message.capture.fileKey));
      cleanupCaptureReferences(removedMessages.flatMap((message) => message.capturePreview?.pdfReference ? [message.capturePreview.pdfReference] : []));
      for (const message of removedMessages) {
        if (message.capture?.handoffId) {
          clearPolicyCaptureHandoff(userId, message.capture.handoffId);
          void deletePolicyCaptureHandoffRemote(message.capture.handoffId);
        }
      }
      setMessages((current) => current.filter((message) => !(message.capture?.fileKey && removedKeys.has(message.capture.fileKey))));
      if (activeCapture?.handoffId && removedMessages.some((message) => message.capture?.handoffId === activeCapture.handoffId)) setActiveCapture(null);
    }
    setAttachedPdfs(nextFiles);
    setAttachmentError(null);
  }

  function updateUploadState(file: File, state: { status: "pending" | "uploading" | "retained" | "unavailable" | "retryable"; progress?: number; label?: string; retryable?: boolean }) {
    setUploadStates((current) => ({
      ...current,
      [fileOperationId(file)]: {
        status: state.status,
        progress: state.progress ?? current[fileOperationId(file)]?.progress ?? 0,
        label: state.label ?? current[fileOperationId(file)]?.label ?? "",
        retryable: state.retryable ?? current[fileOperationId(file)]?.retryable ?? false,
      },
    }));
  }

  async function retainPdf(file: File, purpose: "nora-policy-pdf" | "policy-capture", signal?: AbortSignal, operationId?: string) {
    updateUploadState(file, { status: "uploading", progress: 0, label: "Subiendo…", retryable: false });
    try {
      const uploaded = await uploadPdfWithRetry({
        pathname: buildNoraPolicyPdfPathname(userId, file.name),
        file,
        handleUploadUrl: "/api/nora/policy-pdf/upload",
        clientPayload: JSON.stringify({ userId, purpose, fileName: file.name, operationId: operationId ?? null }),
        signal,
        onProgress: (progress: PdfCaptureUploadProgress) => {
          updateUploadState(file, { status: "uploading", progress: progress.percentage, label: `Subiendo (${progress.attempt}/${progress.maxAttempts})…`, retryable: false });
        },
      });
      updateUploadState(file, { status: "retained", progress: 100, label: "Conservado", retryable: false });
      return uploaded;
    } catch (error) {
      const uploadError = error instanceof PdfCaptureUploadError
        ? error
        : new PdfCaptureUploadError("No se pudo conservar temporalmente el PDF.", { code: "UPLOAD_UNKNOWN", retryable: false, attempts: 0 });
      updateUploadState(file, {
        status: uploadError.retryable ? "retryable" : "unavailable",
        progress: 0,
        label: uploadError.code,
        retryable: uploadError.retryable,
      });
      throw uploadError;
    }
  }

  function savePolicyCapturePreview(preview: PolicyPdfCapturePreview, pdfReference?: { url: string; fileName: string; expiresAt: number } | null, handoffId = makeId(), fileName?: string) {
    const resolvedPdfReference = pdfReference === undefined ? activeCapture?.payload.pdfReference : pdfReference;
    const payload = buildCaptureSessionPayload(preview, resolvedPdfReference, handoffId);
    void persistPolicyCaptureHandoff(userId, payload);
    setActiveCapture({ handoffId, fileName: fileName ?? payload.pdfReference?.fileName ?? activeCapture?.fileName ?? "captura.pdf", payload });
    return handoffId;
  }

  function persistActiveCapture(handoffId: string | null) {
    saveNoraSession(userId, {
      messages,
      input,
      context: activeContext,
      activeCaptureHandoffId: handoffId,
      welcome: initialMessage(snapshot),
    }, { sourceId: instanceIdRef.current });
  }

  function updateCaptureMessage(messageId: string, preview: PolicyPdfCapturePreview, pdfReference?: { url: string; fileName: string; expiresAt: number } | null) {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || !message.capturePreview) return message;
      return {
        ...message,
        source: captureProvenanceSource(preview.provenance),
        capturePreview: {
          ...message.capturePreview,
          provenance: preview.provenance,
          preview,
          pdfReference: pdfReference ?? null,
        },
      };
    }));
  }

  async function retryPdfRetention(file: File, messageId: string, handoffId: string, preview: PolicyPdfCapturePreview) {
    const pendingPreview = withStorageStatus(preview, "pending", { attempts: 0, retryable: true });
    savePolicyCapturePreview(pendingPreview, null, handoffId, file.name);
    updateCaptureMessage(messageId, pendingPreview, null);
    const operationId = makeId();
    const controller = new AbortController();
    operationControllersRef.current.set(operationId, controller);
    operationFilesRef.current.set(operationId, fileOperationId(file));
    try {
      const uploaded = await retainPdf(file, "nora-policy-pdf", controller.signal, operationId);
      const retainedPreview = withStorageStatus(pendingPreview, "retained", { attempts: uploaded.attempts, retryable: false });
      const pdfReference = makePdfReference(uploaded.url, file.name);
      savePolicyCapturePreview(retainedPreview, pdfReference, handoffId, file.name);
      updateCaptureMessage(messageId, retainedPreview, pdfReference);
      toast.success("PDF conservado temporalmente. Ya puedes revisarlo con IA.");
    } catch (error) {
      const uploadError = error instanceof PdfCaptureUploadError ? error : null;
      const failedPreview = withStorageStatus(pendingPreview, uploadError?.retryable ? "retryable" : "unavailable", {
        errorCode: uploadError?.code ?? "UPLOAD_UNKNOWN",
        attempts: uploadError?.attempts,
        retryable: uploadError?.retryable ?? false,
      });
      savePolicyCapturePreview(failedPreview, null, handoffId, file.name);
      updateCaptureMessage(messageId, failedPreview, null);
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "No se pudo conservar temporalmente el PDF.");
    } finally {
      operationControllersRef.current.delete(operationId);
      operationFilesRef.current.delete(operationId);
    }
  }

  async function reanalyzeStoredPdf(reference: { url: string; fileName: string; expiresAt: number }, messageId: string, handoffId: string) {
    if (isSending) return;
    setIsSending(true);
    const controller = new AbortController();
    const operationId = makeId();
    operationControllersRef.current.set(operationId, controller);
    operationFilesRef.current.set(operationId, `${reference.fileName}:stored`);
    try {
      const response = await fetchPdfCaptureWithTimeout("/api/nora/policy-pdf/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: reference.fileName, blobUrl: reference.url, retainBlob: true, mode: "ai", prompt: "Revisa y extrae esta captura con IA." }),
      }, PDF_CAPTURE_ANALYSIS_TIMEOUT_MS, "La revisión IA del PDF tardó demasiado en responder.", controller.signal);
      const payload = await response.json().catch(() => null) as { preview?: PolicyPdfCapturePreview; error?: string } | null;
      if (!response.ok || !payload?.preview) throw new Error(payload?.error || "La revisión IA no pudo completar este PDF.");
      const preview = withStorageStatus(payload.preview, "retained", { retryable: false });
      savePolicyCapturePreview(preview, reference, handoffId, reference.fileName);
      updateCaptureMessage(messageId, preview, reference);
      toast.success("La revisión IA terminó. Revisa las propuestas antes de confirmar.");
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "La revisión IA no pudo completar este PDF.");
    } finally {
      operationControllersRef.current.delete(operationId);
      operationFilesRef.current.delete(operationId);
      setIsSending(false);
    }
  }

  function goToPolicyCapture(preview: PolicyPdfCapturePreview, handoffId = activeCapture?.handoffId ?? makeId(), pdfReference?: { url: string; fileName: string; expiresAt: number } | null) {
    savePolicyCapturePreview(preview, pdfReference, handoffId, pdfReference?.fileName ?? activeCapture?.fileName);
    persistActiveCapture(handoffId);
    router.push(`/policies/capture?handoffId=${encodeURIComponent(handoffId)}`);
  }

  async function selectCaptureContext(message: Message) {
    const handoffId = message.capture?.handoffId ?? message.capturePreview?.handoffId;
    if (!handoffId) return;
    const handoff = loadPolicyCaptureHandoff(userId, handoffId) ?? await restorePolicyCaptureHandoff(userId, handoffId);
    if (!handoff) {
      toast.error("Esta ficha expiró o ya fue eliminada. Vuelve a adjuntar el PDF.");
      return;
    }
    setActiveCapture({ handoffId, fileName: message.capture?.fileName ?? message.capturePreview?.fileName ?? "captura.pdf", payload: handoff.payload });
    persistActiveCapture(handoffId);
    toast.success("Esta captura quedó seleccionada como contexto de Nora.");
  }

  async function requestCaptureCorrection(request: string) {
    if (!activeCapture || isSending) return;
    setLastPrompt(request);
    setMessages((current) => [...current, { id: makeId(), role: "user", text: request }]);
    setInput("");
    setIsSending(true);
    try {
      const payload = activeCapture.payload;
      const response = await fetch("/api/nora/policy-pdf/correct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handoffId: activeCapture.handoffId,
          request,
          capture: {
            draft: payload.draft,
            fieldConfidence: payload.fieldConfidence ?? {},
            selectedClientId: payload.selectedClientId ?? null,
            selectedClientLabel: payload.selectedClientLabel ?? null,
            selectedInsurerId: payload.selectedInsurerId ?? null,
            selectedInsurerLabel: payload.selectedInsurerLabel ?? null,
            selectedSourcePolicyId: payload.selectedSourcePolicyId ?? null,
            selectedSourcePolicyLabel: payload.selectedSourcePolicyLabel ?? null,
            warnings: payload.warnings ?? [],
            aiReview: payload.aiReview ?? null,
            provenance: payload.provenance ?? {
              requestedMode: "local",
              extractionSource: "local",
              reviewSource: "none",
              aiRunIds: [],
              trackingStatus: "recorded",
              aiAttempted: false,
            },
            receiptEvidence: payload.receiptEvidence ?? null,
            relatedDocuments: payload.relatedDocuments ?? [],
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        correction?: PolicyPdfCaptureCorrectionProposal;
        error?: string;
      } | null;
      if (!response.ok || !result?.success || !result.correction) {
        throw new Error(result?.error || "No se pudo revisar la corrección de la captura.");
      }
      const correction = result.correction;
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: correction.summary,
          source: "local",
          captureCorrection: correction,
        },
      ]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No se pudo revisar la corrección de la captura.";
      toast.error(messageText);
      setMessages((current) => [...current, { id: makeId(), role: "assistant", text: messageText, source: "local" }]);
    } finally {
      setIsSending(false);
    }
  }

  function applyCaptureCorrection(messageId: string, proposal: PolicyPdfCaptureCorrectionProposal) {
    const sourceMessage = messages.find((message) => message.id === messageId);
    const pdfReference = sourceMessage?.capturePreview?.pdfReference ?? activeCapture?.payload.pdfReference ?? null;
    const fileName = sourceMessage?.capturePreview?.fileName ?? activeCapture?.fileName ?? "captura.pdf";
    const payload = buildCaptureSessionPayload(proposal.preview, pdfReference, proposal.handoffId);
    void persistPolicyCaptureHandoff(userId, payload);
    setActiveCapture({ handoffId: proposal.handoffId, fileName, payload });
    setMessages((current) => current.map((message) => message.id === messageId
      ? {
          ...message,
          text: "Apliqué la propuesta al borrador de captura. Todavía falta revisarlo y confirmarlo.",
          captureCorrection: null,
          capturePreview: {
            fileName,
            fileKey: message.capturePreview?.fileKey,
            handoffId: proposal.handoffId,
            provenance: proposal.preview.provenance,
            preview: proposal.preview,
            pdfReference,
          },
        }
      : message));
  }

  async function sendMessage(value: string) {
    const message = value.trim();
    if (!message || isSending) return;

    setLastPrompt(message);
    setMessages((current) => [...current, { id: makeId(), role: "user", text: message }]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, context: activeContext, history: buildAssistantHistory(messages) }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; response?: AssistantConversationResponse; error?: string }
        | null;

      if (!response.ok || !payload?.success || !payload.response) {
        throw new Error(payload?.error || "No pude responder esta consulta.");
      }
      const assistantResponse = payload.response;

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text: assistantResponse.reply,
          source: assistantResponse.source,
          sections: assistantResponse.sections,
          quickPrompts: assistantResponse.quickPrompts,
          reportThemeLabel: assistantResponse.reportThemeLabel,
          aiFallbackNotice: assistantResponse.aiFallbackNotice,
          aiDiagnostic: assistantResponse.aiDiagnostic,
          aiRunId: assistantResponse.aiRunId,
          aiTrackingStatus: assistantResponse.aiTrackingStatus,
          aiTier: assistantResponse.aiTier,
          aiModel: assistantResponse.aiModel,
          aiAttempts: assistantResponse.aiAttempts,
          aiUsage: assistantResponse.aiUsage,
          aiTrace: assistantResponse.aiTrace,
          aiToolTrace: assistantResponse.aiToolTrace,
          aiPromptVersion: assistantResponse.aiPromptVersion,
          aiBudgetWarning: assistantResponse.aiBudgetWarning,
          reportId: assistantResponse.reportId,
          actionProposal: assistantResponse.actionProposal,
          todayMetrics: assistantResponse.todayMetrics,
        },
      ]);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No pude responder esta consulta.";
      toast.error(messageText);
      setMessages((current) => [
        ...current,
        { id: makeId(), role: "assistant", text: messageText, source: "local" },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  async function analyzeAttachedPdf(file: File, promptValue: string, options: { manageBusy?: boolean; combinedText?: string; relatedDocuments?: PolicyPdfCaptureRelatedDocument[]; operationId?: string } = {}) {
    const manageBusy = options.manageBusy ?? true;
    if (manageBusy && isSending) return;

    const operationId = options.operationId ?? makeId();
    const controller = new AbortController();
    operationControllersRef.current.set(operationId, controller);
    operationFilesRef.current.set(operationId, fileOperationId(file));
    const signal = controller.signal;
    let retentionPending = false;

    const prompt = promptValue.trim() || "Captura esta póliza";
    setMessages((current) => [...current, { id: makeId(), role: "user", text: prompt }]);
    setInput("");
    if (manageBusy) setIsSending(true);

    try {
      const extractedText = options.combinedText ?? await extractPdfTextFromFile(file, { timeoutMs: 12_000, signal }).catch(() => "");
      const mode = wantsExplicitAi(prompt) ? "ai" : "local";
      const commonPayload = { fileName: file.name, prompt };
      const retentionPromise = extractedText.trim() && mode === "local"
        ? retainPdf(file, "nora-policy-pdf", signal, operationId)
        : null;
      retentionPending = Boolean(retentionPromise);
      if (retentionPromise) void retentionPromise.catch(() => undefined);
      let uploaded: Awaited<ReturnType<typeof uploadPdfWithRetry>> | null = null;
      let storageFallbackError: PdfCaptureUploadError | null = null;
      if (!retentionPromise) {
        try {
          uploaded = await retainPdf(file, "nora-policy-pdf", signal, operationId);
        } catch (error) {
          storageFallbackError = error instanceof PdfCaptureUploadError
            ? error
            : new PdfCaptureUploadError("No se pudo conservar temporalmente el PDF.", { code: "UPLOAD_UNKNOWN", retryable: false, attempts: 0 });
          if (!(mode === "ai" && extractedText.trim())) throw error;
        }
      }
      let response: Response;

      if (extractedText.trim() && mode === "local") {
        response = await fetchPdfCaptureWithTimeout("/api/nora/policy-pdf/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...commonPayload, text: extractedText, retainBlob: false, mode, relatedDocuments: options.relatedDocuments }),
        }, PDF_CAPTURE_ANALYSIS_TIMEOUT_MS, "El análisis del PDF tardó demasiado en responder.", signal);
      } else {
        response = await fetchPdfCaptureWithTimeout("/api/nora/policy-pdf/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...commonPayload,
            ...(uploaded ? { blobUrl: uploaded.url } : { text: extractedText }),
            retainBlob: Boolean(uploaded),
            mode: uploaded ? mode : "local",
            relatedDocuments: options.relatedDocuments,
          }),
        }, PDF_CAPTURE_ANALYSIS_TIMEOUT_MS, "El análisis del PDF tardó demasiado en responder.", signal);
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            analysisSource?: "local" | "ai";
            provenance?: PolicyPdfCaptureProvenance;
            preview?: PolicyPdfCapturePreview;
            pdfReference?: { url: string; fileName: string; expiresAt: number } | null;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.success || !payload.preview) {
        throw new Error(payload?.error || "No pudimos analizar este PDF.");
      }

      let capturePreview = payload.preview;
      let provenance = payload.provenance ?? capturePreview.provenance;
      if (retentionPromise) {
        capturePreview = withStorageStatus(capturePreview, "pending", { retryable: true });
        provenance = capturePreview.provenance;
      } else if (uploaded) {
        capturePreview = withStorageStatus(capturePreview, "retained", { attempts: uploaded.attempts, retryable: false });
        provenance = capturePreview.provenance;
      } else if (storageFallbackError) {
        capturePreview = withStorageStatus(capturePreview, storageFallbackError.retryable ? "retryable" : "unavailable", {
          errorCode: storageFallbackError.code,
          attempts: storageFallbackError.attempts,
          retryable: storageFallbackError.retryable,
        });
        capturePreview = {
          ...capturePreview,
          warnings: [
            ...capturePreview.warnings,
            "La IA fue solicitada, pero no se pudo conservar el PDF temporal; se muestra el resultado local.",
          ].filter((warning, index, warnings) => warnings.indexOf(warning) === index),
          provenance: {
            ...capturePreview.provenance,
            requestedMode: "ai",
            extractionSource: "local",
            reviewSource: "none",
            aiAttempted: false,
            aiFailureCode: "storage_unavailable",
            trackingStatus: "unavailable",
          },
        };
        provenance = capturePreview.provenance;
      }
      const pdfReference = payload.pdfReference ?? (uploaded ? makePdfReference(uploaded.url, file.name) : null);
      const handoffId = savePolicyCapturePreview(capturePreview, pdfReference, makeId(), file.name);
      const messageId = makeId();

      setMessages((current) => [
        ...current,
        {
          id: messageId,
          role: "assistant",
          text:
            provenance.extractionSource === "ai"
              ? "Extraje la carátula con IA y dejé la captura lista para confirmación."
              : provenance.reviewSource === "ai"
                ? "Extraje la carátula localmente y la revisé con IA; dejé la captura lista para confirmación."
                : "Extraje la carátula localmente y dejé la captura lista para confirmación.",
          source: captureProvenanceSource(provenance),
          sections: [
            {
              title: "Siguiente paso",
              summary: "Abre la captura para revisar antes de guardar.",
              items: [
                {
                  title: "Revisar en captura",
                  subtitle: `${capturePreview.draft.policyNumber || "Sin póliza"} · ${capturePreview.draft.clientName || "Sin cliente"}`,
                  href: `/policies/capture?handoffId=${encodeURIComponent(handoffId)}`,
                  meta: "Abrir",
                },
              ],
            },
          ],
          capturePreview: {
            fileName: file.name,
            fileKey: fileOperationId(file),
            handoffId,
            provenance,
            preview: capturePreview,
            pdfReference,
          },
          capture: { handoffId, fileName: file.name, fileKey: fileOperationId(file) },
        },
      ]);

      if (retentionPromise) {
        void retentionPromise.then((retained) => {
          if (signal.aborted) return;
          const retainedPreview = withStorageStatus(capturePreview, "retained", { attempts: retained.attempts, retryable: false });
          const retainedReference = makePdfReference(retained.url, file.name);
          savePolicyCapturePreview(retainedPreview, retainedReference, handoffId, file.name);
          updateCaptureMessage(messageId, retainedPreview, retainedReference);
        }).catch((error) => {
          if (signal.aborted) return;
          const uploadError = error instanceof PdfCaptureUploadError ? error : null;
          const failedPreview = withStorageStatus(capturePreview, uploadError?.retryable ? "retryable" : "unavailable", {
            errorCode: uploadError?.code ?? "UPLOAD_UNKNOWN",
            attempts: uploadError?.attempts,
            retryable: uploadError?.retryable ?? false,
          });
          savePolicyCapturePreview(failedPreview, null, handoffId, file.name);
          updateCaptureMessage(messageId, failedPreview, null);
          toast.error(error instanceof Error ? error.message : "No se pudo conservar temporalmente el PDF.");
        }).finally(() => {
          retentionPending = false;
          if (operationControllersRef.current.get(operationId) === controller) {
            operationControllersRef.current.delete(operationId);
            operationFilesRef.current.delete(operationId);
          }
        });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No pudimos analizar este PDF.";
      if (!signal.aborted) {
        toast.error(messageText);
        setMessages((current) => [
          ...current,
          { id: makeId(), role: "assistant", text: messageText, source: "local" },
        ]);
      }
    } finally {
      if (!retentionPending && operationControllersRef.current.get(operationId) === controller) {
        operationControllersRef.current.delete(operationId);
        operationFilesRef.current.delete(operationId);
      }
      if (manageBusy) setIsSending(false);
    }
  }

  async function analyzeAttachedPdfs(files: File[], promptValue: string) {
    if (isSending || files.length === 0) return;
    setIsSending(true);
    try {
      if (documentMode === "group" && files.length > 1 && !wantsExplicitAi(promptValue)) {
        const documents = await Promise.all(files.map(async (file) => ({
          id: makeId(),
          fileName: file.name,
          kind: /recibo|receipt|pago|cobro/i.test(file.name) ? "receipt" as const : /endoso/i.test(file.name) ? "endorsement" as const : /inciso/i.test(file.name) ? "inciso" as const : "policy" as const,
          source: "local" as const,
          policyNumber: null,
          warnings: [],
          text: await extractPdfTextFromFile(file, { timeoutMs: 12_000 }).catch(() => ""),
        })));
        const combinedText = documents.map((document) => `\n--- ${document.fileName} ---\n${document.text}`).join("\n");
        await analyzeAttachedPdf(files[0], promptValue, {
          manageBusy: false,
          combinedText,
          relatedDocuments: documents.map((document) => ({ id: document.id, fileName: document.fileName, kind: document.kind, source: document.source, policyNumber: document.policyNumber, warnings: document.warnings })),
          operationId: makeId(),
        });
        return;
      }
      for (const file of files) {
        await analyzeAttachedPdf(file, promptValue, { manageBusy: false, operationId: makeId() });
      }
    } finally {
      setIsSending(false);
    }
  }

  function submitCurrentInput() {
    if (isSending) return;
    if (activeCapture && wantsCaptureCorrection(input)) {
      void requestCaptureCorrection(input.trim());
      return;
    }
    if (attachedPdfs.length > 0) {
      void analyzeAttachedPdfs(attachedPdfs, input);
      return;
    }
    void sendMessage(input);
  }

  function resetConversation() {
    setMessages([initialMessage(snapshot)]);
    setInput("");
    clearAttachment();
  }

  async function copyResponse(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Respuesta copiada");
    } catch {
      toast.error("No pude copiar la respuesta.");
    }
  }

  const compact = variant === "panel";

  function handleComposerDragEnter(event: DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("Files") && !isSending) {
      event.preventDefault();
      setIsFileDragOver(true);
    }
  }

  function handleComposerDragOver(event: DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("Files") && !isSending) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsFileDragOver(true);
    }
  }

  function handleComposerDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget === event.target || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
      setIsFileDragOver(false);
    }
  }

  function handleComposerDrop(event: DragEvent<HTMLElement>) {
    setIsFileDragOver(false);
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    if (isSending) return;
    const result = mergePolicyPdfFiles(attachedPdfs, Array.from(event.dataTransfer.files));
    handleAttachedPdfsChange(result.files);
    setAttachmentError(result.error);
    setActiveCapture(null);
  }

  return (
    <section className={cn(
      "relative mx-auto flex w-full max-w-none flex-col overflow-hidden bg-card/90",
      variant === "workspace"
        ? "min-h-0 flex-1 rounded-[1.5rem] border border-border/70 shadow-sm"
        : "min-h-0 flex-1 rounded-none border-0 shadow-none",
    )}
    >
      <header className={cn("flex items-center justify-between border-b border-border/70", variant === "workspace" ? "px-5 py-4 sm:px-7" : "px-3 py-2")}>
        {variant === "workspace" ? (
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-foreground text-background">
            <Bot className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Nora</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Asistente de PolicyDesk · {snapshot.scopeLabel}</span>
              <Badge variant={snapshot.ai.available ? "default" : "outline"} className="rounded-full text-[10px] uppercase tracking-wide">
                {snapshot.ai.available ? `IA configurada · ${snapshot.ai.model}` : "IA no disponible"}
              </Badge>
            </div>
            {activeContext ? (
              <div className="mt-2 flex max-w-full items-center gap-2 text-xs">
                <Badge variant="outline" className="max-w-full truncate rounded-full border-ai/30 bg-ai/5 text-ai">
                  Contexto: {activeContext.type} · {activeContext.id}
                </Badge>
                <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={() => updateContext(null)}>
                  Quitar
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        ) : <p className="text-xs text-muted-foreground">Conversación activa</p>}
        <div className="flex items-center gap-1">
          <NoraExcelDownload compact={variant === "panel"} />
          <Button type="button" variant="ghost" size="sm" onClick={resetConversation} disabled={isSending} aria-label="Iniciar un nuevo chat">
            <RotateCcw className="size-4" />
            {variant === "workspace" ? "Nuevo chat" : null}
          </Button>
        </div>
      </header>
      {storageMode === "memory" ? (
        <div role="status" className={cn("border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100", compact ? "sm:px-4" : "sm:px-7")}>
          Nora continúa en memoria. El chat no sobrevivirá a una recarga y una captura PDF puede requerir volver a subir el archivo.
        </div>
      ) : null}

      <Conversation className="min-h-0" aria-live="polite">
        <ConversationContent className={cn("mx-auto w-full", compact ? "gap-3 px-4 py-4" : "max-w-5xl gap-4 px-4 py-5 sm:px-8")}>
        {messages.map((message) => (
          <article key={message.id} className={cn("flex min-w-0", message.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("min-w-0", message.role === "assistant" ? "w-full" : "max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-background")}>
              {message.role === "assistant" ? (
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Nora</span>
                  {message.source ? <span>{message.source === "ai" ? "IA" : "Local"}</span> : null}
                  {message.reportThemeLabel ? <Badge variant="outline" className="rounded-full text-[10px]">Señal registrada</Badge> : null}
                </div>
              ) : null}
              {message.aiFallbackNotice ? (
                <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {message.aiFallbackNotice}
                </div>
              ) : null}
              {message.aiBudgetWarning ? (
                <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {message.aiBudgetWarning}
                </div>
              ) : null}
              {message.aiDiagnostic ? (
                <div className="mb-2 rounded-2xl border border-amber-300 bg-amber-50/90 px-3 py-3 text-xs text-amber-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Diagnóstico de IA</p>
                    {message.reportId ? (
                      <Link href="/settings/assistant?tab=incidentes" className="font-medium underline underline-offset-2">
                        Ver backlog
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-1">{message.aiDiagnostic.summary}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lastPrompt ? (
                      <Button type="button" size="sm" variant="outline" className="h-7 rounded-full border-amber-300 bg-white/70 text-[11px]" onClick={() => sendMessage(lastPrompt)} disabled={isSending}>
                        <RotateCcw className="mr-1.5 size-3" /> Reintentar
                      </Button>
                    ) : null}
                    <Link href="/settings/assistant?tab=incidentes" className="inline-flex h-7 items-center rounded-full border border-amber-300 bg-white/70 px-3 font-medium underline-offset-2 hover:underline">Abrir diagnóstico</Link>
                  </div>
                  <div className={cn("mt-2 grid gap-1 text-[11px] text-amber-900/80", !compact && "sm:grid-cols-2")}>
                    <span>Código: {message.aiDiagnostic.code}</span>
                    <span>Modelo: {message.aiDiagnostic.model}</span>
                    <span>Duración: {formatDurationMs(message.aiDiagnostic.durationMs)}</span>
                    <span>Folio: {message.aiDiagnostic.diagnosticId}</span>
                    {message.reportId ? <span>Reporte: {message.reportId}</span> : null}
                  </div>
                </div>
              ) : null}
              {message.aiTrace && message.aiTrace.length > 0 ? (
                <details className="mb-2 rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none font-medium text-foreground">
                    Traza de IA
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Corrida</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiRunId ?? "Sin folio"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tier</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiTier ?? "Sin dato"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Modelo</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiModel ?? "Sin dato"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Intentos</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiAttempts ?? message.aiTrace.length}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Perfil</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiExecutionProfile ?? "Sin dato"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Terminación</p>
                        <p className="mt-1 font-medium text-foreground">{message.aiTerminationReason ?? "Sin dato"}{message.aiStepCount != null ? ` · ${message.aiStepCount} pasos` : ""}</p>
                      </div>
                    </div>
                    {message.aiUsage ? (
                      <div className={cn("grid gap-2 rounded-xl border border-border/60 bg-background/80 p-3", compact ? "grid-cols-2" : "sm:grid-cols-4")}>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Input</p>
                          <p className="mt-1 font-medium text-foreground">{formatTokenCount(message.aiUsage.inputTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Output</p>
                          <p className="mt-1 font-medium text-foreground">{formatTokenCount(message.aiUsage.outputTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Texto</p>
                          <p className="mt-1 font-medium text-foreground">{formatTokenCount(message.aiUsage.textTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Razonamiento</p>
                          <p className="mt-1 font-medium text-foreground">{formatTokenCount(message.aiUsage.reasoningTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
                          <p className="mt-1 font-medium text-foreground">{formatTokenCount(message.aiUsage.totalTokens)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Costo</p>
                          <p className="mt-1 font-medium text-foreground">{formatUsageCost(message.aiUsage)}</p>
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      {message.aiTrace.map((entry) => (
                        <div key={`${message.id}-${entry.attemptNumber}-${entry.requestedModel}`} className="rounded-xl border border-border/60 bg-background/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-foreground">
                              Intento {entry.attemptNumber} · {entry.requestedModel}
                            </p>
                            <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
                              {entry.status}
                            </Badge>
                          </div>
                          <div className={cn("mt-2 grid gap-1", !compact && "sm:grid-cols-2")}>
                            <span>Tier: {entry.tier}</span>
                            <span>Modelo final: {entry.finalModel ?? "sin dato"}</span>
                            <span>Motivo: {entry.fallbackReason ?? "sin motivo"}</span>
                            <span>Duración: {formatDurationMs(entry.durationMs ?? 0)}</span>
                            <span>Finish: {entry.finishReason ?? "sin dato"}</span>
                            <span>Código: {entry.code ?? "ok"}</span>
                          </div>
                          {entry.errorMessage ? <p className="mt-2 text-[11px] text-amber-800">Detalle: {entry.errorMessage}</p> : null}
                          {entry.usage ? (
                            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              <span>In: {formatTokenCount(entry.usage.inputTokens)}</span>
                              <span>Out: {formatTokenCount(entry.usage.outputTokens)}</span>
                              <span>Texto: {formatTokenCount(entry.usage.textTokens)}</span>
                              <span>Razonamiento: {formatTokenCount(entry.usage.reasoningTokens)}</span>
                              <span>Total: {formatTokenCount(entry.usage.totalTokens)}</span>
                              <span>Costo: {formatUsageCost(entry.usage)}</span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ) : null}
              {message.role === "assistant" ? <MessageResponse className="text-sm leading-6" isAnimating={false}>{message.text}</MessageResponse> : <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>}
              {message.role === "assistant" && message.text ? (
                <div className="mt-2 flex items-center gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" className="rounded-full text-muted-foreground" onClick={() => copyResponse(message.text)} aria-label="Copiar respuesta" title="Copiar respuesta"><Clipboard className="size-3.5" /></Button>
                  {message.aiDiagnostic ? <Check className="hidden size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
                </div>
              ) : null}
              {message.capturePreview ? (
                <CapturePreviewCard
                  fileName={message.capturePreview.fileName}
                  provenance={message.capturePreview.provenance}
                  preview={message.capturePreview.preview}
                  onOpenCapture={() => goToPolicyCapture(message.capturePreview!.preview, message.capturePreview!.handoffId, message.capturePreview!.pdfReference)}
                  onSelectContext={() => { void selectCaptureContext(message); }}
                  onReanalyzeAi={message.capturePreview.pdfReference && message.capturePreview.provenance.storageStatus !== "unavailable" && message.capturePreview.provenance.storageStatus !== "retryable"
                    ? () => { void reanalyzeStoredPdf(message.capturePreview!.pdfReference!, message.id, message.capturePreview!.handoffId ?? makeId()); }
                    : undefined}
                  onRetryRetention={!message.capturePreview.pdfReference && message.capturePreview.handoffId && attachedPdfs.some((file) => (message.capturePreview?.fileKey ? fileOperationId(file) === message.capturePreview.fileKey : file.name === message.capturePreview?.fileName))
                    ? () => {
                        const file = attachedPdfs.find((candidate) => message.capturePreview?.fileKey ? fileOperationId(candidate) === message.capturePreview.fileKey : candidate.name === message.capturePreview?.fileName);
                        if (file) void retryPdfRetention(file, message.id, message.capturePreview!.handoffId!, message.capturePreview!.preview);
                      }
                    : undefined}
                  compact={compact}
                />
              ) : null}
              {message.captureUnavailable ? (
                <div role="alert" className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {message.captureUnavailable}
                </div>
              ) : null}
              {message.captureCorrection ? (
                <PolicyCaptureCorrectionCard
                  proposal={message.captureCorrection}
                  onApply={() => applyCaptureCorrection(message.id, message.captureCorrection!)}
                  onOpenCapture={() => goToPolicyCapture(message.captureCorrection!.preview, message.captureCorrection!.handoffId)}
                />
              ) : null}
              {message.actionProposal ? <AssistantActionProposalCard proposal={message.actionProposal} onConfirmed={onConfirmed} /> : null}
              {message.quickPrompts && message.quickPrompts.length > 0 && message.role === "assistant" && message.id === messages[messages.length - 1]?.id ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {message.quickPrompts.slice(0, 4).map((prompt) => (
                    <Button
                      key={`${message.id}-${prompt.label}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full bg-background/80 text-xs"
                      onClick={() => sendMessage(prompt.prompt)}
                      disabled={isSending}
                    >
                      {prompt.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {isSending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Nora está revisando tu cartera…
          </div>
        ) : null}
        </ConversationContent>
        <ConversationScrollButton className="bottom-3" aria-label="Ir al mensaje más reciente" />
      </Conversation>

      <footer className={cn("shrink-0 border-t border-border/70 bg-background/95 backdrop-blur", compact ? "p-3" : "p-4 sm:p-5")}>
        <div
          className={cn("relative border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/30", compact ? "rounded-2xl px-3 py-2.5" : "rounded-3xl px-4 py-3")}
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          {isFileDragOver ? (
            <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-[1.25rem] border-2 border-dashed border-primary bg-background/95 text-center shadow-sm">
              <div>
                <UploadCloud className="mx-auto size-6 text-primary" />
                <p className="mt-1 text-xs font-semibold">Suelta tus PDFs aquí</p>
                <p className="text-[10px] text-muted-foreground">Se agregarán a la cola de captura.</p>
              </div>
            </div>
          ) : null}
          {attachmentError ? (
            <div className="mb-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {attachmentError}
            </div>
          ) : null}
          <PolicyPdfFilePicker
            files={attachedPdfs}
            presentation="inline"
            inputRef={fileInputRef}
            onFilesChange={(files) => { handleAttachedPdfsChange(files); if (files.length > 0) setActiveCapture(null); }}
            disabled={isSending}
            allowRemoveWhenDisabled
            fileStatus={(file) => uploadStates[fileOperationId(file)] ?? null}
            onRetryFile={(file) => {
              const captureMessage = messages.find((message) => message.capturePreview && !message.capturePreview.pdfReference && message.capturePreview.handoffId && (message.capturePreview.fileKey ? message.capturePreview.fileKey === fileOperationId(file) : message.capturePreview.fileName === file.name));
              if (captureMessage?.capturePreview?.handoffId) void retryPdfRetention(file, captureMessage.id, captureMessage.capturePreview.handoffId, captureMessage.capturePreview.preview);
            }}
          />
          {attachedPdfs.length > 0 ? (
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Modo de documentos">
                <Button type="button" size="sm" variant={documentMode === "independent" ? "default" : "outline"} className="h-7 rounded-full text-[11px]" onClick={() => setDocumentMode("independent")} disabled={isSending}>Pólizas independientes</Button>
                <Button type="button" size="sm" variant={documentMode === "group" ? "default" : "outline"} className="h-7 rounded-full text-[11px]" onClick={() => setDocumentMode("group")} disabled={isSending}>Agrupar relacionados</Button>
              </div>
              <p>{documentMode === "group" ? "La carátula será principal y los recibos/endosos se tratarán como complementarios en una sola corrida local." : "Cada PDF genera su propia captura y corrida IA."}</p>
            </div>
          ) : null}
          <div className="mt-2 flex min-w-0 items-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            aria-label="Adjuntar PDF"
          >
            <FileUp className="size-4" />
          </Button>
          <Textarea
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              event.currentTarget.scrollLeft = 0;
            }}
            placeholder="Pregunta por una póliza, cliente, renovación, recibo o reporte…"
            rows={1}
            maxLength={2_000}
            className="min-w-0 max-h-36 min-h-8 resize-none overflow-x-hidden border-0 bg-transparent p-0 leading-6 shadow-none focus-visible:ring-0"
            onFocus={(event) => {
              event.currentTarget.scrollLeft = 0;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitCurrentInput();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            onClick={submitCurrentInput}
            disabled={isSending || (!input.trim() && !attachedPdfs.length)}
            aria-label={attachedPdfs.length ? "Analizar PDF" : "Enviar mensaje"}
          >
            <ArrowUp className="size-4" />
          </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
          {compact ? "Verifica la información importante antes de confirmar." : "Nora solo responde sobre PolicyDesk y únicamente usa información accesible para tu usuario."}
          {!compact ? (snapshot.ai.available ? ` IA conectada con ${snapshot.ai.model}.` : " IA no disponible por ahora.") : null}
          {!compact ? " También puedes adjuntar un PDF de póliza." : null}
        </p>
      </footer>
    </section>
  );
}
