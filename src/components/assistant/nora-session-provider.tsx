"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import type { AssistantSnapshot } from "@/lib/assistant-types";
import type { NoraContextRef } from "@/lib/nora-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LazyAssistantConsole = dynamic(
  () => import("@/components/assistant/assistant-console").then((module) => module.AssistantConsole),
  { ssr: false, loading: () => <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin text-ai" /><span className="sr-only">Cargando Nora</span></div> },
);

type NoraSessionValue = {
  open: boolean;
  context: NoraContextRef | null;
  openNora: (starterPrompt?: string) => void;
  closeNora: () => void;
  suggestContext: (context: NoraContextRef) => void;
  clearContext: () => void;
};

const NoraSessionContext = createContext<NoraSessionValue | null>(null);

export function useNoraSession() {
  const value = useContext(NoraSessionContext);
  if (!value) throw new Error("useNoraSession debe usarse dentro de NoraSessionProvider");
  return value;
}

export function NoraSessionProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<NoraContextRef | null>(null);
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starterPrompt, setStarterPrompt] = useState<string | undefined>();

  useEffect(() => {
    if (!open || snapshot || loadError) return;
    const controller = new AbortController();
    fetch("/api/assistant", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.success || !payload.snapshot) throw new Error(payload?.error || "No pude abrir Nora.");
        setSnapshot(payload.snapshot as AssistantSnapshot);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "No pude abrir Nora.");
      });
    return () => controller.abort();
  }, [loadError, open, snapshot]);

  const value = useMemo<NoraSessionValue>(() => ({
    open,
    context,
    openNora: (prompt) => { setStarterPrompt(prompt); setOpen(true); },
    closeNora: () => setOpen(false),
    suggestContext: (next) => { setContext(next); setOpen(true); },
    clearContext: () => setContext(null),
  }), [context, open]);

  const retry = useCallback(() => { setLoadError(null); setSnapshot(null); }, []);

  return (
    <NoraSessionContext.Provider value={value}>
      <Sheet open={open} onOpenChange={setOpen}>
        {children}
        <SheetContent side="right" className="gap-0 overflow-hidden p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(540px,calc(100vw-1rem))]" showCloseButton={false}>
          <SheetHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ai/10 text-ai"><Sparkles className="size-4" /></span>
                <div className="min-w-0"><SheetTitle>Nora</SheetTitle><SheetDescription className="truncate">Asistente operativo</SheetDescription></div>
              </div>
              <div className="flex items-center gap-1">
                <Button asChild variant="ghost" size="icon" aria-label="Abrir Nora en espacio completo"><Link href="/assistant"><ExternalLink className="size-4" /></Link></Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar Nora"><X className="size-4" /></Button>
              </div>
            </div>
            {context ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-ai/20 bg-ai/5 px-3 py-2 text-xs">
                <span className="truncate">Contexto: {context.type} · {context.id}</span>
                <button type="button" onClick={() => setContext(null)} className="font-medium text-ai hover:underline">Quitar</button>
              </div>
            ) : null}
          </SheetHeader>
          {loadError ? (
            <div className="grid flex-1 place-items-center p-6 text-center"><div><p className="text-sm text-muted-foreground">{loadError}</p><Button className="mt-3" variant="outline" onClick={retry}>Reintentar</Button></div></div>
          ) : snapshot ? (
            <LazyAssistantConsole snapshot={snapshot} userId={userId} variant="panel" context={context} initialPrompt={starterPrompt} />
          ) : (
            <div className="grid flex-1 place-items-center"><Loader2 className="size-5 animate-spin text-ai" /><span className="sr-only">Cargando Nora</span></div>
          )}
        </SheetContent>
      </Sheet>
    </NoraSessionContext.Provider>
  );
}

export function NoraContextButton({ context, label = "Trabajar con Nora" }: { context: NoraContextRef; label?: string }) {
  const { suggestContext } = useNoraSession();
  return <Button type="button" variant="outline" onClick={() => suggestContext(context)}><Sparkles className="size-4 text-ai" />{label}</Button>;
}

export function NoraOpenButton({ label, prompt, className, variant = "outline" }: { label: string; prompt?: string; className?: string; variant?: "default" | "outline" | "secondary" | "ghost" }) {
  const { openNora } = useNoraSession();
  return <Button type="button" variant={variant} className={className} onClick={() => openNora(prompt)}><Sparkles className={cn("size-4", variant === "default" ? "text-primary-foreground" : "text-ai")} />{label}</Button>;
}
