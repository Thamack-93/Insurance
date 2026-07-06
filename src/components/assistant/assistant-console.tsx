"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type {
  AssistantConversationResponse,
  AssistantPrompt,
  AssistantSection,
  AssistantSnapshot,
} from "@/lib/assistant-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  source?: AssistantConversationResponse["source"];
  sections?: AssistantSection[];
  quickPrompts?: AssistantPrompt[];
  reportThemeLabel?: string | null;
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

export function AssistantConsole({ snapshot }: { snapshot: AssistantSnapshot }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => [initialMessage(snapshot)]);
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

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

  function resetConversation() {
    setMessages([initialMessage(snapshot)]);
    setInput("");
  }

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-9rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-card/90 shadow-sm">
      <header className="flex items-center justify-between border-b border-border/70 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-foreground text-background">
            <Bot className="size-5" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-tight">Nora</h1>
            <p className="text-xs text-muted-foreground">Asistente de PolicyDesk · {snapshot.scopeLabel}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={resetConversation} disabled={isSending}>
          <RotateCcw className="mr-2 size-4" />
          Nuevo chat
        </Button>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto px-4 py-7 sm:px-8">
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

      <footer className="border-t border-border/70 bg-background/70 p-4 backdrop-blur sm:p-5">
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card px-4 py-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
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
                void sendMessage(input);
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isSending}
            aria-label="Enviar mensaje"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Nora solo responde sobre PolicyDesk y únicamente usa información accesible para tu usuario.
        </p>
      </footer>
    </section>
  );
}
