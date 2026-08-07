import Link from "next/link";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";

export type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
  className?: string;
};

function buildHref(basePath: string, params: Record<string, string | undefined>, page: number) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value.length > 0) sp.set(key, value);
  }
  if (page > 1) sp.set("page", String(page));
  else sp.delete("page");
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams = {},
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  if (totalPages <= 1 && total <= pageSize) {
    return null;
  }

  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);
  const prevPage = Math.max(1, safePage - 1);
  const nextPage = Math.min(totalPages, safePage + 1);

  const baseClass =
    "inline-flex h-8 items-center gap-1 rounded-full border bg-card px-3 text-xs font-medium text-foreground transition hover:bg-muted/40";
  const disabledClass = "pointer-events-none opacity-40";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground",
        className
      )}
    >
      <span>
        {total === 0
          ? "Sin resultados"
          : `Mostrando ${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Link
          aria-label="Página anterior"
          href={buildHref(basePath, searchParams, prevPage)}
          className={cn(baseClass, safePage <= 1 && disabledClass)}
          aria-disabled={safePage <= 1}
        >
          <ChevronLeft className="size-3" />
          Anterior
        </Link>
        <span className="px-1 text-foreground">
          {safePage} / {totalPages}
        </span>
        <Link
          aria-label="Página siguiente"
          href={buildHref(basePath, searchParams, nextPage)}
          className={cn(baseClass, safePage >= totalPages && disabledClass)}
          aria-disabled={safePage >= totalPages}
        >
          Siguiente
          <ChevronRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
