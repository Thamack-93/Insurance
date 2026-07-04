"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildTableHref } from "@/lib/table-query";

export type ColumnFilterOption = {
  value: string;
  label: string;
};

type ColumnFilterProps = {
  filterKey: string;
  label: string;
  options: ColumnFilterOption[];
  placeholder?: string;
  className?: string;
};

export function ColumnFilter({
  filterKey,
  label,
  options,
  placeholder = "Todos",
  className,
}: ColumnFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(filterKey) ?? "__all__";

  return (
    <label className={className}>
      <span className="sr-only">{label}</span>
      <Select
        value={value}
        onValueChange={(next) => {
          router.replace(
            buildTableHref(pathname, searchParams, { [filterKey]: next === "__all__" ? null : next }, { resetPage: true }),
            { scroll: false },
          );
        }}
      >
        <SelectTrigger className="h-9 rounded-full px-3 text-sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
