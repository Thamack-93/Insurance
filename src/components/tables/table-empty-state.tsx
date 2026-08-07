import type { LucideIcon } from "lucide-react";

import { EmptyState, type EmptyStateAction } from "@/components/empty-states/empty-state";

export type TableEmptyStateProps = {
  icon: LucideIcon;
  /** True when a search or a column filter is narrowing the list. */
  isFiltered: boolean;
  /** Where "Limpiar filtros" leads: the same list with no filters. */
  clearHref: string;
  /** Plural noun used in the no-matches copy, e.g. "pólizas". */
  noun: string;
  /** Copy for the genuinely-empty case. */
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: EmptyStateAction;
  /** Echoed back to the user so they can see what was searched. */
  query?: string;
};

/**
 * Keeps "there is nothing here yet" and "your filters matched nothing" visibly
 * different. The first invites the user to create the first record; the second
 * says what was filtered and offers a one-click way back to the full list.
 */
export function TableEmptyState({
  icon,
  isFiltered,
  clearHref,
  noun,
  emptyTitle,
  emptyDescription,
  emptyAction,
  query,
}: TableEmptyStateProps) {
  if (!isFiltered) {
    return (
      <div className="p-4">
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className="p-4">
      <EmptyState
        icon={icon}
        title="Sin coincidencias"
        description={
          query
            ? `Ningún registro de ${noun} coincide con “${query}” y los filtros activos.`
            : `Ningún registro de ${noun} coincide con los filtros activos.`
        }
        action={{ label: "Limpiar filtros", href: clearHref }}
      />
    </div>
  );
}
