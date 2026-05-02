"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, FolderKanban, ReceiptText, CheckSquare, AlertTriangle, Calculator, Building2 } from "lucide-react";
import { useSearch } from "./search-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const entityIcons = {
  client: Users,
  policy: FolderKanban,
  receipt: ReceiptText,
  task: CheckSquare,
  claim: AlertTriangle,
  quote: Calculator,
  insurer: Building2,
};

const entityLabels = {
  client: "Cliente",
  policy: "Póliza",
  receipt: "Recibo",
  task: "Pendiente",
  claim: "Siniestro",
  quote: "Cotización",
  insurer: "Aseguradora",
};

export function SearchResults() {
  const { searchResults, isSearching, searchQuery, clearSearch } = useSearch();
  const router = useRouter();

  if (!searchQuery) {
    return null;
  }

  return (
    <div className="absolute left-0 right-0 top-full mt-2 max-h-[400px] overflow-y-auto rounded-lg border bg-white shadow-lg z-50">
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="size-4" />
          {isSearching ? (
            <span>Buscando...</span>
          ) : (
            <span>{searchResults.length} resultados</span>
          )}
        </div>
      </div>

      {searchResults.length === 0 && !isSearching ? (
        <div className="p-6 text-center text-muted-foreground">
          <Search className="mx-auto size-8 mb-2 opacity-50" />
          <p className="text-sm">No se encontraron resultados</p>
        </div>
      ) : (
        <div className="py-1">
          {searchResults.map((result) => {
            const Icon = entityIcons[result.type];
            const label = entityLabels[result.type];
            
            return (
              <button
                key={result.id}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-stone-50 transition-colors text-left"
                onClick={() => {
                  router.push(result.href);
                  clearSearch();
                }}
              >
                <div className="flex-shrink-0">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{result.title}</p>
                    <Badge variant="secondary" className="text-xs">
                      {label}
                    </Badge>
                  </div>
                  {result.subtitle && (
                    <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="p-3 border-t">
          <Button variant="outline" size="sm" onClick={clearSearch} className="w-full">
            Limpiar búsqueda
          </Button>
        </div>
      )}
    </div>
  );
}
