"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type SearchResultType =
  | "client"
  | "policy"
  | "receipt"
  | "workItem"
  | "claim"
  | "quote"
  | "insurer"
  | "document";

export type SearchResultMatch = {
  field: string;
  fieldLabel: string;
  snippet: string;
};

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  parentLabel?: string;
  href: string;
  match?: SearchResultMatch;
};

type SearchContextType = {
  searchResults: SearchResult[];
  isSearching: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
};

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const cancelActiveSearch = useCallback(() => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSearching(false);
  }, []);

  const updateSearchQuery = useCallback((query: string) => {
    cancelActiveSearch();
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
    }
  }, [cancelActiveSearch]);

  const performSearch = useCallback(async (query: string) => {
    const normalizedQuery = query.trim();
    cancelActiveSearch();
    if (!normalizedQuery) {
      setSearchResults([]);
      return;
    }

    const requestId = requestIdRef.current;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsSearching(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`, {
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error("Search failed");
      const results: SearchResult[] = await response.json();
      if (requestId !== requestIdRef.current) return;
      setSearchResults(results);
    } catch {
      if (abortController.signal.aborted || requestId !== requestIdRef.current) return;
      setSearchResults([]);
      toast.error("No se pudo completar la búsqueda. Intenta de nuevo.");
    } finally {
      if (requestId !== requestIdRef.current) return;
      abortControllerRef.current = null;
      setIsSearching(false);
    }
  }, [cancelActiveSearch]);

  const clearSearch = useCallback(() => {
    cancelActiveSearch();
    setSearchQuery("");
    setSearchResults([]);
  }, [cancelActiveSearch]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      abortControllerRef.current?.abort();
    };
  }, []);

  return (
    <SearchContext.Provider
      value={{
        searchResults,
        isSearching,
        searchQuery,
        setSearchQuery: updateSearchQuery,
        performSearch,
        clearSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
}
