"use client";

import { useRouter } from "next/navigation";
import { memo } from "react";
import {
  Search,
  Users,
  FolderKanban,
  ReceiptText,
  CheckSquare,
  AlertTriangle,
  Calculator,
  Building2,
  FileText,
} from "lucide-react";
import { useSearch, type SearchResult, type SearchResultType } from "./search-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Highlight } from "./highlight";
import { SEARCH_ENTITY_LABELS } from "@/lib/ui-labels";

const entityIcons: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  client: Users,
  policy: FolderKanban,
  receipt: ReceiptText,
  workItem: CheckSquare,
  claim: AlertTriangle,
  quote: Calculator,
  insurer: Building2,
  document: FileText,
};

const entityLabels: Record<SearchResultType, string> = SEARCH_ENTITY_LABELS;

const groupOrder: SearchResultType[] = [
  "client",
  "policy",
  "receipt",
  "claim",
  "quote",
  "workItem",
  "insurer",
  "document",
];

export const SearchResults = memo(function SearchResults() {
  const { searchResults, isSearching, searchQuery, clearSearch } = useSearch();
  const router = useRouter();

  if (!searchQuery) return null;

  const grouped = new Map<SearchResultType, SearchResult[]>();
  for (const r of searchResults) {
    const arr = grouped.get(r.type) ?? [];
    arr.push(r);
    grouped.set(r.type, arr);
  }

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[420px] overflow-y-auto rounded-md border bg-popover shadow-lg">
      <div className="border-b p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="size-4" />
          {isSearching ? <span>Buscando...</span> : <span>{searchResults.length} resultados</span>}
        </div>
      </div>

      {searchResults.length === 0 && !isSearching ? (
        <div className="p-6 text-center text-muted-foreground">
          <Search className="mx-auto mb-2 size-8 opacity-50" />
          <p className="text-sm">No se encontraron resultados</p>
        </div>
      ) : (
        <div className="py-1">
          {groupOrder
            .filter((t) => grouped.has(t))
            .map((type) => {
              const Icon = entityIcons[type];
              const items = grouped.get(type)!;
              return (
                <div key={type} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {entityLabels[type]}
                  </div>
                  {items.map((result) => (
                    <button
                      key={result.id}
                      className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40"
                      onClick={() => {
                        router.push(result.href);
                        clearSearch();
                      }}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            <Highlight text={result.title} query={searchQuery} />
                          </p>
                          <Badge variant="secondary" className="text-xs">
                            {entityLabels[result.type]}
                          </Badge>
                        </div>
                        {result.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>
                        )}
                        {result.match && (
                          <p className="truncate text-xs text-muted-foreground">
                            Coincidencia en {result.match.fieldLabel}: “
                            <Highlight text={result.match.snippet} query={searchQuery} />”
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="border-t p-3">
          <Button variant="outline" size="sm" onClick={clearSearch} className="w-full">
            Limpiar búsqueda
          </Button>
        </div>
      )}
    </div>
  );
});
