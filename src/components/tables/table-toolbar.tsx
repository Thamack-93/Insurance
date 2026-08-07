"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListSearch } from "@/components/lists/list-search";
import { buildTableHref } from "@/lib/table-query";
import { ColumnFilter, type ColumnFilterOption } from "./column-filter";
import { ExportMenu } from "./export-menu";
import { TableResultCount } from "./table-result-count";

export type TableFilter = {
  key: string;
  label: string;
  options: ColumnFilterOption[];
  placeholder?: string;
};

function readTablePreferences(pathname: string) {
  if (typeof window === "undefined") return {} as { hiddenColumns?: number[]; density?: "compact" | "comfortable" | "spacious" };
  try {
    return JSON.parse(window.localStorage.getItem(`policydesk.table:${pathname}`) ?? "{}") as {
      hiddenColumns?: number[];
      density?: "compact" | "comfortable" | "spacious";
    };
  } catch {
    return {};
  }
}

type TableToolbarProps = {
  searchPlaceholder?: string;
  filters?: TableFilter[];
  clearLabel?: string;
  actions?: ReactNode;
  className?: string;
  tableControls?: boolean;
  /** Rows matching the active filters. Shown next to the search field. */
  resultCount?: number;
  /** Rows available with no filters applied, to render "N de M". */
  totalCount?: number;
  /** Singular/plural noun used in the count, e.g. `["póliza", "pólizas"]`. */
  resultNoun?: [string, string];
  /** Dataset key from `src/lib/export-datasets.ts`; enables CSV/Excel export. */
  exportDataset?: string;
};

export function TableToolbar({
  searchPlaceholder = "Buscar...",
  filters = [],
  clearLabel = "Limpiar",
  actions,
  className,
  tableControls = true,
  resultCount,
  totalCount,
  resultNoun,
  exportDataset,
}: TableToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFilters = filters.filter((filter) => searchParams.get(filter.key));
  const hasSearch = Boolean(searchParams.get("q"));
  const hasSort = Boolean(searchParams.get("sort")) || Boolean(searchParams.get("dir"));
  const [columns, setColumns] = useState<Array<{ index: number; label: string }>>([]);
  const [hiddenColumns, setHiddenColumns] = useState<number[]>(() => readTablePreferences(pathname).hiddenColumns ?? []);
  const [density, setDensity] = useState<"compact" | "comfortable" | "spacious">(() => readTablePreferences(pathname).density ?? "comfortable");

  function getTable() {
    return rootRef.current?.closest<HTMLElement>("[data-slot='card']")?.querySelector<HTMLTableElement>("table") ?? null;
  }

  function inspectTable() {
    const table = getTable();
    if (!table) return;
    setColumns([...table.querySelectorAll("thead th")].map((cell, index) => ({
      index,
      label: cell.textContent?.replace(/\s+/g, " ").trim() || `Columna ${index + 1}`,
    })));
  }

  useEffect(() => {
    const table = getTable();
    if (!table) return;
    table.dataset.density = density;
    for (const row of table.querySelectorAll("tr")) {
      [...row.children].forEach((cell, index) => {
        if (cell instanceof HTMLElement) cell.hidden = hiddenColumns.includes(index);
      });
    }
    try {
      window.localStorage.setItem(`policydesk.table:${pathname}`, JSON.stringify({ hiddenColumns, density }));
    } catch {
      // Preferences remain available for the current session when storage is unavailable.
    }
  }, [density, hiddenColumns, pathname, columns]);

  function cycleDensity() {
    setDensity((current) => current === "comfortable" ? "compact" : current === "compact" ? "spacious" : "comfortable");
  }

  function clearAll() {
    const updates = Object.fromEntries([
      ["q", null],
      ["page", null],
      ["sort", null],
      ["dir", null],
      ...filters.map((filter) => [filter.key, null] as const),
    ]);
    router.replace(buildTableHref(pathname, searchParams, updates, { resetPage: false }), { scroll: false });
  }

  const isFiltered = hasSearch || activeFilters.length > 0;

  return (
    <div ref={rootRef} className={className ?? "flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"}>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <ListSearch placeholder={searchPlaceholder} className="md:max-w-sm" />
        {filters.map((filter) => (
          <ColumnFilter key={filter.key} filterKey={filter.key} label={filter.label} options={filter.options} placeholder={filter.placeholder ?? filter.label} />
        ))}
        {isFiltered || hasSort ? (
          <Button type="button" variant="outline" onClick={clearAll}>
            {clearLabel}
          </Button>
        ) : null}
        {resultCount === undefined ? null : (
          <TableResultCount
            count={resultCount}
            total={totalCount}
            isFiltered={isFiltered}
            noun={resultNoun}
          />
        )}
      </div>
      {tableControls || actions || exportDataset ? <div className="flex flex-wrap items-center gap-2">
        {tableControls ? <>
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" onClick={inspectTable} />}>
              <Columns3 className="mr-2 size-4" /> Columnas
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.index}
                  checked={!hiddenColumns.includes(column.index)}
                  onCheckedChange={(checked) => {
                    setHiddenColumns((current) => checked
                      ? current.filter((index) => index !== column.index)
                      : [...current, column.index]);
                  }}
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        <Button type="button" variant="outline" size="sm" onClick={cycleDensity} title={`Densidad: ${density}`}>
          <Rows3 className="mr-2 size-4" /> Densidad
        </Button>
        </> : null}
        {exportDataset ? <ExportMenu dataset={exportDataset} /> : null}
        {actions}
      </div> : null}
    </div>
  );
}
