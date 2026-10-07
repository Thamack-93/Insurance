"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListSearch } from "@/components/lists/list-search";
import { buildTableHref } from "@/lib/table-query";
import {
  RENEWAL_BOARD_WINDOWS,
  renewalBoardWindowLabels,
  UNASSIGNED_OWNER_VALUE,
  type RenewalBoardFilters as Filters,
} from "@/lib/renewal-board.logic";

const ALL_OWNERS = "__all__";

type Option = { value: string; label: string };

/**
 * El filtro comparte el mecanismo de la URL con el resto de las vistas
 * (`buildTableHref`), pero declara sus opciones con `items` para que el
 * disparador muestre la etiqueta y no el valor crudo.
 */
function BoardSelect({
  label,
  filterKey,
  value,
  options,
  clearValue,
  className,
}: {
  label: string;
  filterKey: string;
  value: string;
  options: Option[];
  /** Valor que significa "sin filtro" y por tanto borra el parámetro. */
  clearValue?: string;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-sm text-muted-foreground">
        {label}
      </label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          router.replace(
            buildTableHref(
              pathname,
              searchParams,
              { [filterKey]: next === clearValue ? null : String(next) },
              { resetPage: true },
            ),
            { scroll: false },
          );
        }}
      >
        <SelectTrigger id={id} className={className ?? "h-9 px-3 text-sm"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RenewalBoardFilters({
  filters,
  owners,
  canFilterByOwner,
}: {
  filters: Filters;
  owners: { id: string; name: string }[];
  canFilterByOwner: boolean;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-3 lg:flex-nowrap">
      <ListSearch placeholder="Buscar cliente, póliza o aseguradora..." className="min-w-64 flex-1 md:max-w-sm" />
      <BoardSelect
        label="Vencimiento"
        filterKey="window"
        value={filters.window}
        options={RENEWAL_BOARD_WINDOWS.map((value) => ({ value, label: renewalBoardWindowLabels[value] }))}
      />
      {canFilterByOwner ? (
        <BoardSelect
          label="Responsable"
          filterKey="owner"
          value={filters.owner ?? ALL_OWNERS}
          clearValue={ALL_OWNERS}
          options={[
            { value: ALL_OWNERS, label: "Todos" },
            ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
            { value: UNASSIGNED_OWNER_VALUE, label: "Sin asignar" },
          ]}
        />
      ) : null}
    </div>
  );
}
