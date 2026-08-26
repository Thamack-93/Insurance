"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { statusLabel } from "@/lib/status";

type SourceOption = { id: string; title: string; status: string; version: string };
type SearchResult = {
  sourceId: string;
  chunkId: string;
  chunkOrdinal: number;
  sourceType: "INTERNAL" | "GENERAL";
  title: string;
  version: string;
  sourceUrl: string | null;
  authority: string | null;
  reviewedAt: string | null;
  page: number | null;
  section: string | null;
  excerpt: string;
  match: number;
};

export function KnowledgeBaseTester({ sources }: { sources: SourceOption[] }) {
  const [question, setQuestion] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [abstained, setAbstained] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: question, sourceType: "INTERNAL", limit: "5" });
      if (sourceId) params.set("sourceId", sourceId);
      const response = await fetch(`/api/admin/knowledge-base/search?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { results?: SearchResult[]; abstained?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo probar la fuente.");
      setResults(payload.results ?? []);
      setAbstained(payload.abstained === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo probar la fuente.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div>
        <p className="text-sm font-medium">Probar antes de activar</p>
        <p className="text-xs text-muted-foreground">Incluye borradores solo en esta vista administrativa; Nora nunca recupera fuentes no activas.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Escribe una pregunta operativa" maxLength={500} />
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Todas las fuentes internas</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.title} · v{source.version} · {statusLabel(source.status)}</option>)}
        </select>
      </div>
      <Button type="button" onClick={() => void search()} disabled={loading || question.trim().length < 2} className="rounded-full">
        {loading ? "Buscando…" : "Probar búsqueda"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {abstained ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">No hay evidencia interna activa o en borrador que responda esta pregunta.</p> : null}
      {results.length ? (
        <div className="space-y-2">
          {results.map((result) => (
            <div key={`${result.sourceId}-${result.chunkId}`} className="rounded-xl border border-border/70 bg-background p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full">{result.title}</Badge>
                <span>v{result.version}</span>
                {result.authority ? <span>· {result.authority}</span> : null}
                {result.section ? <span>· {result.section}</span> : null}
                {result.page != null ? <span>· p. {result.page}</span> : null}
                {result.sourceUrl ? <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="underline">origen</a> : null}
              </div>
              <p className="mt-2 text-muted-foreground">{result.excerpt}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
