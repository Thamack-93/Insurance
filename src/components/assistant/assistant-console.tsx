"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, FileUp, Loader2, RotateCcw, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import type {
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
import { cn } from "@/lib/utils";
import { extractPdfTextFromFile } from "@/lib/pdf-text-extraction.browser";
import { buildNoraPolicyPdfPathname, NORA_POLICY_PDF_MAX_BYTES } from "@/lib/nora-pdf-storage.shared";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: AssistantConversationResponse["source"];
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
  reportThemeLabel?: string | null;
  capturePreview?: {
    fileName: string;
    analysisSource: "local" | "ai";
    preview: PolicyPdfCapturePreview;
  };
  actionProposal?: AssistantConversationResponse["actionProposal"];
};

const CAPTURE_SESSION_KEY = "policydesk.policyPdfCapture.v2";

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

function ResultSection({ section }: { section: AssistantSection }) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-background/80">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-medium">{section.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{section.summary}</p>
      </div>
      {section.items.length > 0 ? (
        <div className="divide-y divide-border/60">
          {section.items.map((item) => (
            <Link
              key={`${item.href}-${item.title}`}
              href={item.href}
              className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</p>
              </div>
              {item.meta ? <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">{item.meta}</Badge> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
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
}: {
  fileName: string;
  analysisSource: "local" | "ai";
  preview: PolicyPdfCapturePreview;
  onOpenCapture: (preview: PolicyPdfCapturePreview) => void;
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
          {analysisSource === "ai" ? "IA" : "Local"}
        </Badge>
      </div>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Póliza</p>
          <p className="mt-1 text-sm font-medium">{draft.policyNumber || "Sin dato"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cliente</p>
          <p className="mt-1 text-sm font-medium">{draft.clientName || "Sin dato"}</p>
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
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground">Abre la captura para revisar, ajustar y confirmar.</p>
        <Button type="button" size="sm" className="rounded-full" onClick={() => onOpenCapture(preview)}>
          Revisar captura
        </Button>
      </div>
    </div>
  );
}

export function AssistantConsole({ snapshot, userId }: { snapshot: AssistantSnapshot; userId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [initialMessage(snapshot)]);
  const [isSending, setIsSending] = useState(false);
  const [attachedPdf, setAttachedPdf] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

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
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CAPTURE_SESSION_KEY, JSON.stringify(buildCaptureSessionPayload(preview)));
    }
  }

  function goToPolicyCapture(preview: PolicyPdfCapturePreview) {
    savePolicyCapturePreview(preview);
    router.push("/policies/capture");
  }

  async function sendMessage(value: string) {
    const message = value.trim();
    if (!message || isSending) return;

    setMessages((current) => [...current, { id: makeId(), role: "user", text: message }]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
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
          actionProposal: assistantResponse.actionProposal,
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

  return (
    <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/90 shadow-sm">
      <header className="flex items-center justify-between border-b border-border/70 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-foreground text-background">
            <Bot className="size-5" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-tight">Nora</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Asistente de PolicyDesk · {snapshot.scopeLabel}</span>
              <Badge variant={snapshot.ai.available ? "default" : "outline"} className="rounded-full text-[10px] uppercase tracking-wide">
                {snapshot.ai.available ? `IA conectada · ${snapshot.ai.model}` : "IA desconectada"}
              </Badge>
            </div>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={resetConversation} disabled={isSending}>
          <RotateCcw className="mr-2 size-4" />
          Nuevo chat
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 py-7 sm:px-8">
        {messages.map((message) => (
          <article key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] sm:max-w-[78%]", message.role === "user" && "rounded-3xl rounded-br-lg bg-foreground px-4 py-3 text-background")}>
              {message.role === "assistant" ? (
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Nora</span>
                  {message.source ? <span>{message.source === "ai" ? "IA" : "Local"}</span> : null}
                  {message.reportThemeLabel ? <Badge variant="outline" className="rounded-full text-[10px]">Señal registrada</Badge> : null}
                </div>
              ) : null}
              <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
              {message.capturePreview ? (
                <CapturePreviewCard
                  fileName={message.capturePreview.fileName}
                  analysisSource={message.capturePreview.analysisSource}
                  preview={message.capturePreview.preview}
                  onOpenCapture={goToPolicyCapture}
                />
              ) : null}
              {message.actionProposal ? <AssistantActionProposalCard proposal={message.actionProposal} /> : null}
              {message.sections?.map((section) => <ResultSection key={`${message.id}-${section.title}`} section={section} />)}
              {message.quickPrompts && message.role === "assistant" ? (
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
        <div ref={endRef} />
      </div>

      <footer className="shrink-0 border-t border-border/70 bg-background/70 p-4 backdrop-blur sm:p-5">
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
          <div className="mb-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {attachmentError}
          </div>
        ) : null}
        {attachedPdf ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium">{attachedPdf.name}</p>
              <p className="text-muted-foreground">{(attachedPdf.size / (1024 * 1024)).toFixed(1)} MB · PDF</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 rounded-full" onClick={clearAttachment} aria-label="Quitar PDF">
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
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
            onChange={(event) => setInput(event.target.value)}
            placeholder="Pregunta por una póliza, cliente, renovación, recibo o reporte…"
            rows={1}
            maxLength={2_000}
            className="max-h-36 min-h-8 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
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
            disabled={isSending || (!input.trim() && !attachedPdf)}
            aria-label={attachedPdf ? "Analizar PDF" : "Enviar mensaje"}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Nora solo responde sobre PolicyDesk y únicamente usa información accesible para tu usuario.
          {snapshot.ai.available ? ` IA conectada con ${snapshot.ai.model}.` : " IA no disponible por ahora."} También puedes adjuntar un PDF de póliza.
        </p>
      </footer>
    </section>
  );
}
