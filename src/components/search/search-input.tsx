"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearch } from "./search-provider";
import { SearchResults } from "./search-results";

export function SearchInput() {
  const { searchQuery, setSearchQuery, performSearch, clearSearch, activeResultIndex, setActiveResultIndex } = useSearch();
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        performSearch(searchQuery);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFocus = () => {
    setIsOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    if (query.trim()) {
      setSearchQuery(query);
    } else {
      clearSearch();
    }
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const resultCount = document.querySelectorAll("[data-search-result]").length;
      if (resultCount > 0) {
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActiveResultIndex((activeResultIndex + delta + resultCount) % resultCount);
      }
      return;
    }
    if (e.key === "Enter" && activeResultIndex >= 0) {
      e.preventDefault();
      const target = document.querySelectorAll<HTMLButtonElement>("[data-search-result]")[activeResultIndex];
      target?.click();
      return;
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      setActiveResultIndex(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Buscar clientes, pólizas, siniestros..."
          aria-label="Buscar clientes, pólizas, siniestros"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="global-search-results"
          aria-activedescendant={activeResultIndex >= 0 ? `global-search-result-${activeResultIndex}` : undefined}
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-3 border-0 shadow-none bg-transparent focus-visible:ring-0 h-8"
        />
      </div>
      {isOpen && <SearchResults />}
    </div>
  );
}
