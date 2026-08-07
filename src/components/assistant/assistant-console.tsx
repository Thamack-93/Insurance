"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, Clipboard, FileUp, Loader2, RotateCcw, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import type {
  AssistantAiTraceEntry,
  AssistantAiUsageSnapshot,
  AssistantConversationResponse,
  AssistantPrompt,
  AssistantSection,
  AssistantSnapshot,
} from "@/lib/assistant-types";
import type { PolicyPdfCapturePreview } from "@/lib/policy-pdf-capture.shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AssistantActionProposalCard } from "@/components/assistant/assistant-action-proposal-card";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { extractPdfTextFromFile } from "@/lib/pdf-text-extraction.browser";
import { buildNoraPolicyPdfPathname, NORA_POLICY_PDF_MAX_BYTES } from "@/lib/nora-pdf-storage.shared";
import type { NoraContextRef } from "@/lib/nora-context";
import { NoraExcelDownload } from "@/components/assistant/nora-excel-download";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { cleanupLegacyNoraState, getNoraStorageMode, loadNoraSession, NORA_SESSION_EVENT, saveNoraSession, savePolicyCaptureHandoff, type NoraStorageMode } from "@/lib/nora-browser-session";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: AssistantConversationResponse["source"];
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
  reportThemeLabel?: string | null;
  aiRunId?: string | null;
  aiTier?: string | null;
  aiModel?: string | null;
  aiAttempts?: number;
  aiUsage?: AssistantAiUsageSnapshot | null;
  aiTrace?: AssistantAiTraceEntry[];
  aiFallbackNotice?: string | null;
  aiDiagnostic?: AssistantConversationResponse["aiDiagnostic"];
  reportId?: string | null;
  capturePreview?: {
    fileName: string;
    analysisSource: "local" | "ai";
    preview: PolicyPdfCapturePreview;
  };
  actionProposal?: AssistantConversationResponse["actionProposal"];
  todayMetrics?: AssistantConversationResponse["todayMetrics"];
};

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function buildCaptureSessionPayload(preview: PolicyPdfCapturePreview) {
  return {
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
  };
}

function CapturePreviewCard({
  fileName,
  analysisSource,
  preview,
  onOpenCapture,
  compact = false,
}: {
  fileName: string;
  analysisSource: "local" | "ai";
  preview: PolicyPdfCapturePreview;
  onOpenCapture: (preview: PolicyPdfCapturePreview) => void;
  compact?: boolean;
}) {
  const { draft } = preview;
  const warnings = preview.warnings.slice(0, 3);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-background/90 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Carátula detectada</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{fileName}</p>
        </div>
        <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
          {analysisSource === "ai" ? "IA" : "Local"}
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
      <div className={cn("gap-3 border-t border-border/60 px-4 py-3", compact ? "grid" : "flex items-center justify-between")}>
        <p className="text-xs text-muted-foreground">Abre la captura para revisar, ajustar y confirmar.</p>
        <Button type="button" size="sm" className={cn("", compact && "w-full")} onClick={() => onOpenCapture(preview)}>
          Revisar captura
        </Button>
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [initialMessage(snapshot)]);
  const [isSending, setIsSending] = useState(false);
  const [attachedPdf, setAttachedPdf] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [activeContext, setActiveContext] = useState<NoraContextRef | null>(context);
  const [storageMode, setStorageMode] = useState<NoraStorageMode>("persistent");
  const restoredUserIdRef = useRef<string | null>(null);
  const contextInitializedRef = useRef(false);
  const instanceIdRef = useRef(makeId());
  const lastSessionUpdatedAtRef = useRef(0);

  function updateContext(next: NoraContextRef | null) {
    setActiveContext(next);
    onContextChange?.(next);
  }

  useEffect(() => {
    if (restoredUserIdRef.current === userId) return;
    restoredUserIdRef.current = userId;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        cleanupLegacyNoraState();
        const stored = loadNoraSession(userId);
        if (stored?.messages.length) {
          setMessages(stored.messages as Message[]);
          setInput(stored.input);
          lastSessionUpdatedAtRef.current = stored.updatedAt;
          if (!context && stored.context) {
            setActiveContext(stored.context);
            onContextChange?.(stored.context);
          }
        } else if (initialPrompt) {
          setInput(initialPrompt);
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
    const onSessionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; updatedAt?: number; sourceId?: string }>).detail;
      if (detail?.userId !== userId || detail.sourceId === instanceIdRef.current || !detail.updatedAt || detail.updatedAt <= lastSessionUpdatedAtRef.current) return;
      const stored = loadNoraSession(userId);
      if (!stored?.messages.length) return;
      lastSessionUpdatedAtRef.current = stored.updatedAt;
      setMessages(stored.messages as Message[]);
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
      welcome: initialMessage(snapshot),
    }, { sourceId: instanceIdRef.current });
    if (saved) {
      const stored = loadNoraSession(userId);
      if (stored) lastSessionUpdatedAtRef.current = stored.updatedAt;
    }
    return saved;
  }, [activeContext, input, messages, snapshot, userId]);

  useEffect(() => {
    if (!sessionReady) return;
    saveSession();
    queueMicrotask(() => setStorageMode(getNoraStorageMode()));
  }, [saveSession, sessionReady]);

  useEffect(() => {
    if (!onHandoffReady) return;
    onHandoffReady(() => { saveSession(); });
  }, [onHandoffReady, saveSession, sessionReady]);

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
    setAttachedPdf(null);
    setAttachmentError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function onPdfSelected(file: File | null) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf" && file.type !== "application/octet-stream") {
      setAttachmentError("Solo acepto archivos PDF.");
      setAttachedPdf(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    if (file.size > NORA_POLICY_PDF_MAX_BYTES) {
      setAttachmentError("El PDF supera el límite de 10 MB.");
      setAttachedPdf(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setAttachmentError(null);
    setAttachedPdf(file);
  }

  function savePolicyCapturePreview(preview: PolicyPdfCapturePreview) {
    savePolicyCaptureHandoff(userId, buildCaptureSessionPayload(preview));
  }

  function goToPolicyCapture(preview: PolicyPdfCapturePreview) {
    savePolicyCapturePreview(preview);
    router.push("/policies/capture");
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
        body: JSON.stringify({ message, context: activeContext }),
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
          aiTier: assistantResponse.aiTier,
          aiModel: assistantResponse.aiModel,
          aiAttempts: assistantResponse.aiAttempts,
          aiUsage: assistantResponse.aiUsage,
          aiTrace: assistantResponse.aiTrace,
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

  async function analyzeAttachedPdf(file: File, promptValue: string) {
    if (isSending) return;

    const prompt = promptValue.trim() || "Captura esta póliza";
    setMessages((current) => [...current, { id: makeId(), role: "user", text: prompt }]);
    setInput("");
    setIsSending(true);

    try {
      const extractedText = await extractPdfTextFromFile(file).catch(() => "");
      const commonPayload = { fileName: file.name, prompt };
      let response: Response;

      if (extractedText.trim()) {
        response = await fetch("/api/nora/policy-pdf/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...commonPayload, text: extractedText }),
        });
      } else {
        const pathname = buildNoraPolicyPdfPathname(userId, file.name);
        const uploaded = await upload(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/nora/policy-pdf/upload",
          contentType: "application/pdf",
          multipart: file.size > 5 * 1024 * 1024,
          clientPayload: JSON.stringify({
            userId,
            purpose: "nora-policy-pdf",
            fileName: file.name,
          }),
        });

        response = await fetch("/api/nora/policy-pdf/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...commonPayload, blobUrl: uploaded.url }),
        });
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            analysisSource?: "local" | "ai";
            preview?: PolicyPdfCapturePreview;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.success || !payload.preview) {
        throw new Error(payload?.error || "No pudimos analizar este PDF.");
      }

      const capturePreview = payload.preview;
      savePolicyCapturePreview(capturePreview);

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          text:
            payload.analysisSource === "ai"
              ? "Ya revisé la carátula con IA y dejé la captura lista para confirmación."
              : "Ya revisé la carátula con el texto extraído y dejé la captura lista para confirmación.",
          source: payload.analysisSource,
          sections: [
            {
              title: "Siguiente paso",
              summary: "Abre la captura para revisar antes de guardar.",
              items: [
                {
                  title: "Revisar en captura",
                  subtitle: `${capturePreview.draft.policyNumber || "Sin póliza"} · ${capturePreview.draft.clientName || "Sin cliente"}`,
                  href: "/policies/capture",
                  meta: "Abrir",
                },
              ],
            },
          ],
          capturePreview: {
            fileName: file.name,
            analysisSource: payload.analysisSource ?? "local",
            preview: capturePreview,
          },
        },
      ]);

      clearAttachment();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "No pudimos analizar este PDF.";
      toast.error(messageText);
      setMessages((current) => [
        ...current,
        { id: makeId(), role: "assistant", text: messageText, source: "local" },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function submitCurrentInput() {
    if (isSending) return;
    if (attachedPdf) {
      void analyzeAttachedPdf(attachedPdf, input);
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

  return (
    <section className={cn(
      "mx-auto flex w-full max-w-none flex-col overflow-hidden bg-card/90",
      variant === "workspace"
        ? "min-h-0 flex-1 rounded-xl border border-border/70 shadow-sm"
        : "min-h-0 flex-1 rounded-none border-0 shadow-none",
    )}>
      <header className={cn("flex items-center justify-between border-b border-border/70", variant === "workspace" ? "px-5 py-4 sm:px-7" : "px-3 py-2")}>
        {variant === "workspace" ? (
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-foreground text-background">
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
            <div className={cn("min-w-0", message.role === "assistant" ? "w-full" : "max-w-[85%] rounded-xl rounded-br-md bg-foreground px-4 py-3 text-background")}>
              {message.role === "assistant" ? (
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Nora</span>
                  {message.source ? <span>{message.source === "ai" ? "IA" : "Local"}</span> : null}
                  {message.reportThemeLabel ? <Badge variant="outline" className="rounded-full text-[10px]">Señal registrada</Badge> : null}
                </div>
              ) : null}
              {message.aiFallbackNotice ? (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {message.aiFallbackNotice}
                </div>
              ) : null}
              {message.aiDiagnostic ? (
                <div className="mb-2 rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-3 text-xs text-amber-950">
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
                      <Button type="button" size="sm" variant="outline" className="h-7 border-amber-300 bg-white/70 text-[11px]" onClick={() => sendMessage(lastPrompt)} disabled={isSending}>
                        <RotateCcw className="mr-1.5 size-3" /> Reintentar
                      </Button>
                    ) : null}
                    <Link href="/settings/assistant?tab=incidentes" className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-white/70 px-3 font-medium underline-offset-2 hover:underline">Abrir diagnóstico</Link>
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
                <details className="mb-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
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
                          {entry.usage ? (
                            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              <span>In: {formatTokenCount(entry.usage.inputTokens)}</span>
                              <span>Out: {formatTokenCount(entry.usage.outputTokens)}</span>
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
                  <Button type="button" size="icon-sm" variant="ghost" className="text-muted-foreground" onClick={() => copyResponse(message.text)} aria-label="Copiar respuesta" title="Copiar respuesta"><Clipboard className="size-3.5" /></Button>
                  {message.aiDiagnostic ? <Check className="hidden size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
                </div>
              ) : null}
              {message.capturePreview ? (
                <CapturePreviewCard
                  fileName={message.capturePreview.fileName}
                  analysisSource={message.capturePreview.analysisSource}
                  preview={message.capturePreview.preview}
                  onOpenCapture={goToPolicyCapture}
                  compact={compact}
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
                      className="h-8 bg-background/80 text-xs"
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
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            onPdfSelected(file);
          }}
        />
        {attachmentError ? (
          <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {attachmentError}
          </div>
        ) : null}
        {attachedPdf ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium">{attachedPdf.name}</p>
              <p className="text-muted-foreground">{(attachedPdf.size / (1024 * 1024)).toFixed(1)} MB · PDF</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" onClick={clearAttachment} aria-label="Quitar PDF">
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
        <div className={cn("flex min-w-0 items-end gap-2 border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/30", compact ? "rounded-xl px-3 py-2.5" : "rounded-xl px-4 py-3")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
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
            className="size-9 shrink-0"
            onClick={submitCurrentInput}
            disabled={isSending || (!input.trim() && !attachedPdf)}
            aria-label={attachedPdf ? "Analizar PDF" : "Enviar mensaje"}
          >
            <ArrowUp className="size-4" />
          </Button>
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
