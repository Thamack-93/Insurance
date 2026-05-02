"use client";

import { useState, useCallback } from "react";
import { Search, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterConfig = {
  key: string;
  label: string;
  type: "search" | "select" | "date";
  options?: FilterOption[];
};

export type ActiveFilter = {
  key: string;
  value: string;
  label: string;
};

type DataFiltersProps = {
  filters: FilterConfig[];
  activeFilters: ActiveFilter[];
  onFilterChange: (key: string, value: string) => void;
  onFilterRemove: (key: string) => void;
  onClearAll: () => void;
};

export function DataFilters({
  filters,
  activeFilters,
  onFilterChange,
  onFilterRemove,
  onClearAll,
}: DataFiltersProps) {
  const [searchValue, setSearchValue] = useState("");

  const handleSearchSubmit = useCallback(() => {
    if (searchValue.trim()) {
      onFilterChange("search", searchValue.trim());
    }
  }, [searchValue, onFilterChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearchSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-20"
          />
          <Button
            size="sm"
            variant="ghost"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
            onClick={handleSearchSubmit}
          >
            Buscar
          </Button>
        </div>

        {/* Filter Popover */}
        <Popover>
          <PopoverTrigger>
            <Button variant="outline" className="gap-2">
              <Filter className="size-4" />
              Filtros
              {activeFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeFilters.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <h4 className="font-medium">Filtros avanzados</h4>
              {filters.map((filter) => (
                <div key={filter.key} className="space-y-2">
                  <label className="text-sm text-muted-foreground">
                    {filter.label}
                  </label>
                  {filter.type === "select" && filter.options && (
                    <Select
                      value={
                        activeFilters.find((f) => f.key === filter.key)?.value ||
                        ""
                      }
                      onValueChange={(value) =>
                        onFilterChange(filter.key, value ?? "")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Seleccionar ${filter.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {filter.options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {filter.type === "search" && (
                    <Input
                      placeholder={`Filtrar por ${filter.label.toLowerCase()}...`}
                      value={
                        activeFilters.find((f) => f.key === filter.key)?.value ||
                        ""
                      }
                      onChange={(e) =>
                        onFilterChange(filter.key, e.target.value)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Clear All Button */}
        {activeFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearAll} className="gap-1">
            <X className="size-4" />
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Active Filters */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Filtros activos:</span>
          {activeFilters.map((filter) => (
            <Badge
              key={filter.key}
              variant="secondary"
              className="cursor-pointer gap-1 pr-1"
              onClick={() => onFilterRemove(filter.key)}
            >
              {filter.label}: {filter.value}
              <X className="size-3" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
