export type TableSortDirection = "asc" | "desc";

export type TableSearchParams = Record<string, string | string[] | undefined>;

function firstParamValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function readTableParam(params: TableSearchParams, key: string) {
  const value = firstParamValue(params[key]);
  return typeof value === "string" ? value : undefined;
}

export function readAllowedTableParam<T extends string>(
  params: TableSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = readTableParam(params, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function readTablePage(params: TableSearchParams, fallback = 1) {
  const raw = readTableParam(params, "page");
  if (!raw) return fallback;
  const page = Number(raw);
  if (!Number.isFinite(page)) return fallback;
  return Math.max(1, Math.floor(page));
}

export function readTableSort(
  params: TableSearchParams,
  sortKeyParam = "sort",
  directionParam = "dir",
): { sortKey: string | null; direction: TableSortDirection | null } {
  const sortKey = readTableParam(params, sortKeyParam);
  const direction = readTableParam(params, directionParam);
  if (direction !== "asc" && direction !== "desc") {
    return { sortKey: sortKey ?? null, direction: sortKey ? "asc" : null };
  }
  return { sortKey: sortKey ?? null, direction };
}

export function buildTableHref(
  basePath: string,
  params: URLSearchParams | TableSearchParams,
  updates: Record<string, string | number | null | undefined>,
  options?: { resetPage?: boolean },
) {
  const isSearchParamsLike =
    typeof (params as URLSearchParams).get === "function" && typeof (params as URLSearchParams).toString === "function";
  const next = new URLSearchParams(isSearchParamsLike ? params.toString() : "");

  if (!isSearchParamsLike) {
    for (const [key, value] of Object.entries(params)) {
      const nextValue = firstParamValue(value);
      if (typeof nextValue === "string" && nextValue.length > 0) {
        next.set(key, nextValue);
      }
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      next.delete(key);
      continue;
    }
    next.set(key, String(value));
  }

  if (options?.resetPage !== false) {
    next.delete("page");
  }

  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
