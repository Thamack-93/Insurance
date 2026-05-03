"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { toast } from "sonner";

type SearchResult = {
  id: string;
  type: "client" | "policy" | "receipt" | "task" | "claim" | "quote" | "insurer";
  title: string;
  subtitle?: string;
  href: string;
  data: any;
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

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // Fetch search results from API
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Search failed");

      const results: SearchResult[] = await response.json();
      setSearchResults(results);
    } catch (error) {
      setSearchResults([]);
      toast.error("No se pudo completar la búsqueda. Intenta de nuevo.");
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  return (
    <SearchContext.Provider
      value={{
        searchResults,
        isSearching,
        searchQuery,
        setSearchQuery,
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
