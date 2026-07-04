"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildTableHref, type TableSortDirection } from "@/lib/table-query";
import type { TableDensity } from "./data-table";

export type TableStateOptions = {
  storageKey: string;
  sortParam?: string;
  directionParam?: string;
  defaultDensity?: TableDensity;
};

function readStoredDensity(storageKey: string, fallback: TableDensity) {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === "compact" || raw === "comfortable" || raw === "spacious") return raw;
  return fallback;
}

export function useTableState({
  storageKey,
  sortParam = "sort",
  directionParam = "dir",
  defaultDensity = "comfortable",
}: TableStateOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [density, setDensity] = useState<TableDensity>(() => readStoredDensity(`${storageKey}:density`, defaultDensity));

  const sortKey = searchParams.get(sortParam);
  const sortDirection = searchParams.get(directionParam) as TableSortDirection | null;

  const updateUrl = useCallback(
    (updates: Record<string, string | number | null | undefined>, options?: { resetPage?: boolean }) => {
      router.replace(buildTableHref(pathname, searchParams, updates, options), { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setDensityPreference = useCallback(
    (value: TableDensity) => {
      setDensity(value);
      window.localStorage.setItem(`${storageKey}:density`, value);
    },
    [storageKey],
  );

  const clearSearchState = useCallback(
    (keys: string[] = []) => {
      const updates = Object.fromEntries(keys.map((key) => [key, null]));
      updateUrl({ ...updates, [sortParam]: null, [directionParam]: null, page: null }, { resetPage: false });
    },
    [directionParam, sortParam, updateUrl],
  );

  return useMemo(
    () => ({
      density,
      setDensity: setDensityPreference,
      sortKey,
      sortDirection,
      updateUrl,
      clearSearchState,
    }),
    [clearSearchState, density, setDensityPreference, sortDirection, sortKey, updateUrl],
  );
}
