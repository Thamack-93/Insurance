"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { buildTableHref } from "@/lib/table-query";

type SortableTableHeadProps = {
  sortKey: string;
  children: ReactNode;
  className?: string;
  sortParam?: string;
  directionParam?: string;
};

export function SortableTableHead({
  sortKey,
  children,
  className,
  sortParam = "sort",
  directionParam = "dir",
}: SortableTableHeadProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeKey = searchParams.get(sortParam);
  const activeDirection = searchParams.get(directionParam);
  const isActive = activeKey === sortKey && (activeDirection === "asc" || activeDirection === "desc");
  const ariaSort = !isActive ? "none" : activeDirection === "desc" ? "descending" : "ascending";

  function handleSort() {
    let nextDirection: string | null = "asc";

    if (activeKey === sortKey) {
      if (activeDirection === "asc") nextDirection = "desc";
      else if (activeDirection === "desc") nextDirection = null;
    }

    router.replace(buildTableHref(pathname, searchParams, { [sortParam]: nextDirection ? sortKey : null, [directionParam]: nextDirection }, { resetPage: true }), {
      scroll: false,
    });
  }

  return (
    <TableHead aria-sort={ariaSort} className={cn("select-none", className)}>
      <button
        type="button"
        onClick={handleSort}
        className="inline-flex w-full items-center gap-2 text-left font-medium text-foreground transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span>{children}</span>
        {ariaSort === "ascending" ? <ArrowUp className="size-3.5" /> : ariaSort === "descending" ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 text-muted-foreground" />}
      </button>
    </TableHead>
  );
}
