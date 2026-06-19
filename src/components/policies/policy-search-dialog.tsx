"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GlobalSearchResult } from "@/lib/search";

type PolicySearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  sourceLabel: string;
  initialQuery: string;
  suggestions?: string[];
  searchScope?: "portfolio" | "all";
  onSelect: (result: GlobalSearchResult) => Promise<boolean | void> | boolean | void;
};

type PolicySearchDialogBodyProps = Omit<PolicySearchDialogProps, "open" | "onOpenChange"> & {
  onRequestClose: () => void;
};

function PolicySearchDialogBody({
  title,
  description,
  placeholder,
  sourceLabel,
  initialQuery,
  suggestions = [],
  searchScope = "portfolio",
  onSelect,
  onRequestClose,
}: PolicySearchDialogBodyProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  function clearPendingSearch() {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    abortRef.current?.abort();
    abortRef.current = null;
  }

  function scheduleSearch(nextQuery: string) {
    clearPendingSearch();

    const trimmed = nextQuery.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    debounceRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}${searchScope === "all" ? "&scope=all" : ""}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        if (!response.ok) {
          throw new Error("No se pudo buscar ahora mismo.");
        }

        const data = (await response.json()) as GlobalSearchResult[];
        if (requestId === requestIdRef.current) {
          setResults((Array.isArray(data) ? data : []).filter((result) => result.type === "policy").slice(0, 8));
        }
      } catch (fetchError) {
        if ((fetchError as Error).name === "AbortError") return;
        if (requestId === requestIdRef.current) {
          setError(fetchError instanceof Error ? fetchError.message : "No se pudo buscar ahora mismo.");
          setResults([]);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 250);
  }

  async function selectResult(result: GlobalSearchResult) {
    try {
      setIsSubmitting(true);
      const shouldClose = await onSelect(result);
      if (shouldClose !== false) {
        onRequestClose();
      }
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "No se pudo completar la acción.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const suggestionButtons = [...new Set(suggestions.map((value) => value.trim()).filter(Boolean))];

  return (
    <DialogContent className="max-w-3xl" showCloseButton>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description}
          <span className="block text-xs text-muted-foreground">Origen: {sourceLabel}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              scheduleSearch(nextValue);
            }}
            placeholder={placeholder}
            className="h-10 pl-9"
            autoComplete="off"
          />
        </div>

        {suggestionButtons.length ? (
          <div className="flex flex-wrap gap-2">
            {suggestionButtons.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  setQuery(suggestion);
                  scheduleSearch(suggestion);
                }}
                disabled={isSubmitting}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="max-h-[360px] overflow-auto rounded-2xl border border-border/70 bg-muted/20">
          {error ? (
            <div className="px-4 py-6 text-sm text-destructive">{error}</div>
          ) : isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Buscando sugerencias...
            </div>
          ) : query.trim().length < 2 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              Empieza a escribir para ver coincidencias por póliza, cliente, aseguradora o serie.
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No encontramos coincidencias para esta búsqueda.
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-60"
                  onClick={() => void selectResult(result)}
                  disabled={isSubmitting}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{result.title}</span>
                      <Badge variant="outline" className="rounded-full text-[11px] uppercase tracking-wide">
                        {result.type}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {result.subtitle ?? "Sin descripción"}
                    </p>
                    {result.details?.length ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {result.details.join(" · ")}
                      </p>
                    ) : null}
                    {result.match ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Coincidencia: {result.match.fieldLabel} · {result.match.snippet}
                      </p>
                    ) : null}
                  </div>
                  <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="rounded-full" onClick={onRequestClose} disabled={isSubmitting}>
          Cancelar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PolicySearchDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  sourceLabel,
  initialQuery,
  suggestions = [],
  searchScope = "portfolio",
  onSelect,
}: PolicySearchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PolicySearchDialogBody
          key={`${initialQuery}-${searchScope}`}
          title={title}
          description={description}
          placeholder={placeholder}
          sourceLabel={sourceLabel}
          initialQuery={initialQuery}
          suggestions={suggestions}
          searchScope={searchScope}
          onSelect={onSelect}
          onRequestClose={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}
