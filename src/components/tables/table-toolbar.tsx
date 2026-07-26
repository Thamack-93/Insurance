"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3, Download, Rows3 } from "lucide-react";
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
};

export function TableToolbar({
  searchPlaceholder = "Buscar...",
  filters = [],
  clearLabel = "Limpiar",
  actions,
  className,
  tableControls = true,
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

  function exportCurrentPage() {
    const table = getTable();
    if (!table) return;
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.children]
        .filter((cell) => cell instanceof HTMLElement && !cell.hidden)
        .map((cell) => `"${(cell.textContent ?? "").replace(/\s+/g, " ").trim().replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pathname.split("/").filter(Boolean).join("-") || "tabla"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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

  return (
    <div ref={rootRef} className={className ?? "flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"}>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <ListSearch placeholder={searchPlaceholder} className="md:max-w-sm" />
        {filters.map((filter) => (
          <ColumnFilter key={filter.key} filterKey={filter.key} label={filter.label} options={filter.options} placeholder={filter.placeholder ?? filter.label} />
        ))}
        {hasSearch || activeFilters.length > 0 || hasSort ? (
          <Button type="button" variant="outline" className="rounded-full" onClick={clearAll}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
      {tableControls || actions ? <div className="flex flex-wrap items-center gap-2">
        {tableControls ? <>
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="rounded-full" onClick={inspectTable} />}>
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
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={cycleDensity} title={`Densidad: ${density}`}>
          <Rows3 className="mr-2 size-4" /> Densidad
        </Button>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={exportCurrentPage}>
          <Download className="mr-2 size-4" /> CSV
        </Button>
        </> : null}
        {actions}
      </div> : null}
    </div>
  );
}
