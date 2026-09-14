"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buildTableHref } from "@/lib/table-query";
import { cn } from "@/lib/utils";

export type StatusFilterButtonOption = {
  value: string;
  label: string;
  count: number;
};

export function StatusFilterButtons({
  paramKey = "status",
  selectedValue,
  options,
  allValue = "ALL",
  allLabel = "Todas",
  className,
}: {
  paramKey?: string;
  /** The effective value after applying the page's default. */
  selectedValue: string;
  options: StatusFilterButtonOption[];
  allValue?: string;
  allLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allOption = { value: allValue, label: allLabel, count: options.reduce((sum, option) => sum + option.count, 0) };
  const visibleOptions = [allOption, ...options.filter((option) => option.value !== allValue)];

  return (
    <div
      className={cn("flex flex-wrap gap-2 overflow-x-auto pb-1", className)}
      role="group"
      aria-label="Filtrar por estado"
    >
      {visibleOptions.map((option) => {
        const selected = selectedValue === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected ? "default" : "outline"}
            aria-pressed={selected}
            onClick={() => {
              router.replace(
                buildTableHref(pathname, searchParams, { [paramKey]: option.value }, { resetPage: true }),
                { scroll: false },
              );
            }}
          >
            {option.label}
            <span className="ml-0.5 rounded-md bg-current/10 px-1.5 py-0.5 text-xs tabular-nums">
              {option.count}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
