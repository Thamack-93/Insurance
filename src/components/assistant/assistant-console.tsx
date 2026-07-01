"use client";

import Link from "next/link";
import { useState } from "react";
import { Bot, FileUp, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type {
  AssistantPrompt,
  AssistantConversationResponse,
  AssistantSection,
  AssistantSnapshot,
} from "@/lib/assistant-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RefreshPageButton } from "@/components/risk-resolution/refresh-page-button";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: AssistantConversationResponse["source"];
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
  reportId?: string | null;
  reportThemeLabel?: string | null;
};

function makeId() {
  return Math.random().toString(36).slice(2);
}

function SectionCard({ section }: { section: AssistantSection }) {
  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{section.title}</CardTitle>
        <CardDescription>{section.summary}</CardDescription>
      </CardHeader>
      {section.items.length > 0 ? (
        <CardContent className="space-y-3">
          {section.items.map((item) => (
            <Link
              key={`${section.title}-${item.title}-${item.href}`}
              href={item.href}
              className="block rounded-2xl border border-border/60 bg-background/70 p-3 transition hover:border-primary/40 hover:bg-accent/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.subtitle}</p>
                </div>
                {item.meta ? <Badge variant="secondary" className="rounded-full">{item.meta}</Badge> : null}
              </div>
            </Link>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function AssistantConsole({ snapshot }: { snapshot: AssistantSnapshot }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: makeId(),
      role: "assistant",
      text: snapshot.welcome,
      sections: snapshot.sections,
      quickPrompts: snapshot.quickPrompts,
      source: "local",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setIsSending(true);
    const userMessage: Message = {
      id: makeId(),
      role: "user",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");

    void (async () => {
      try {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; response?: AssistantConversationResponse; error?: string }
          | null;

        if (!response.ok || !payload?.success || !payload.response) {
          throw new Error(payload?.error || "No se pudo responder la consulta.");
        }

        const assistantMessage: Message = {
          id: makeId(),
          role: "assistant",
          text: payload.response.reply,
          source: payload.response.source,
          sections: payload.response.sections,
          quickPrompts: payload.response.quickPrompts,
          reportId: payload.response.reportId,
          reportThemeLabel: payload.response.reportThemeLabel,
        };

        setMessages((current) => [...current, assistantMessage]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "No se pudo responder la consulta.";
        setError(message);
        toast.error(message);
      } finally {
        setIsSending(false);
      }
    })();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="space-y-6">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bot className="size-5" />
              Asistente
              <Badge variant="secondary" className="rounded-full">
                {snapshot.scopeLabel}
              </Badge>
            </CardTitle>
            <CardDescription>
              Consulta rápida, respuesta local primero y fallback con IA cuando la pregunta necesite más contexto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {error ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {snapshot.summaryCards.map((card) => (
                <Link
                  key={card.label}
                  href={card.href}
                  className="rounded-2xl border border-border/70 bg-background/70 p-4 transition hover:border-primary/40 hover:bg-accent/20"
                >
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{card.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
                </Link>
              ))}
            </div>

            <div className="rounded-3xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-primary">Probar un PDF</p>
                  <p className="text-sm text-muted-foreground">
                    Si quieres capturar una póliza desde PDF, entra al flujo dedicado y revisa el borrador antes de guardar.
                  </p>
                </div>
                <Button asChild className="rounded-full">
                  <Link href="/policies/capture">
                    <FileUp className="mr-2 size-4" />
                    Abrir captura
                  </Link>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Pregunta por clientes, pólizas, riesgos, recibos o pide un reporte."
                rows={4}
                className="rounded-2xl"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    sendMessage(input);
                  }
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => sendMessage(input)} disabled={isSending} className="rounded-full">
                  {isSending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
                  Enviar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setInput("");
                    setError(null);
                  }}
                  disabled={isSending}
                >
                  Limpiar
                </Button>
                <RefreshPageButton label="Actualizar vista" className="rounded-full" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {snapshot.quickPrompts.map((prompt) => (
                <Button
                  key={prompt.label}
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => sendMessage(prompt.prompt)}
                  disabled={isSending}
                >
                  <Sparkles className="mr-2 size-4" />
                  {prompt.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {messages.map((message) => (
            <Card key={message.id} className={message.role === "assistant" ? "border-border/70 bg-card/90" : "border-primary/20 bg-primary/5"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {message.role === "assistant" ? <Bot className="size-4" /> : null}
                  {message.role === "assistant" ? "Asistente" : "Tú"}
                  {message.source ? (
                    <Badge variant="secondary" className="rounded-full">
                      {message.source === "ai" ? "IA" : "Local"}
                    </Badge>
                  ) : null}
                  {message.reportThemeLabel ? (
                    <Badge variant="outline" className="rounded-full">
                      Reporte
                    </Badge>
                  ) : null}
                </CardTitle>
                {message.reportThemeLabel ? (
                  <CardDescription>Se registró o actualizó el tema: {message.reportThemeLabel}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message.text}</p>
                {message.quickPrompts && message.quickPrompts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {message.quickPrompts.map((prompt) => (
                      <Button
                        key={`${message.id}-${prompt.label}`}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={() => sendMessage(prompt.prompt)}
                        disabled={isSending}
                      >
                        {prompt.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {message.sections && message.sections.length > 0 ? (
                  <div className="grid gap-3">
                    {message.sections.map((section) => (
                      <SectionCard key={`${message.id}-${section.title}`} section={section} />
                    ))}
                  </div>
                ) : null}
                {message.reportId ? (
                  <p className="text-xs text-muted-foreground">Reporte vinculado: {message.reportId}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pistas rápidas</CardTitle>
            <CardDescription>
              El asistente trabaja local-first; si la pregunta necesita más contexto, cae al modelo vía AI Gateway.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Usa el campo principal para pedir resúmenes, búsquedas o reportes.</p>
            <p>Si subes PDFs, sigue usando el flujo de captura y el preview humano antes de guardar.</p>
            <p>Los temas repetidos y los errores alimentan el backlog en Configuración para que no se abran duplicados.</p>
          </CardContent>
        </Card>

        {snapshot.sections.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}
      </div>
    </div>
  );
}
