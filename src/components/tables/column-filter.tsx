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
  allValue?: string;
  className?: string;
};

export function ColumnFilter({
  filterKey,
  label,
  options,
  placeholder = "Todos",
  allValue = "__all__",
  className,
}: ColumnFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(filterKey) ?? allValue;
  const filteredOptions = options.filter((option) => option.value !== allValue);
  const items = Object.fromEntries([
    [allValue, placeholder],
    ...filteredOptions.map((option) => [option.value, option.label]),
  ]);

  return (
    <label className={className}>
      <span className="sr-only">{label}</span>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          router.replace(
            buildTableHref(pathname, searchParams, { [filterKey]: next === allValue ? null : next }, { resetPage: true }),
            { scroll: false },
          );
        }}
      >
        <SelectTrigger className="h-9 px-3 text-sm" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>{placeholder}</SelectItem>
          {filteredOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
