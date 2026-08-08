import { cn } from "@/lib/utils";

export type TableResultCountProps = {
  /** Rows matching the active filters. */
  count: number;
  /** Rows available with no filters applied. */
  total?: number;
  isFiltered?: boolean;
  /** Singular and plural noun, defaults to "resultado"/"resultados". */
  noun?: [string, string];
  className?: string;
};

const numberFormat = new Intl.NumberFormat("es-MX");

/**
 * The single place that phrases "how many rows am I looking at". When filters
 * are active it also reports the unfiltered total, so the user can tell a small
 * result set apart from a small database.
 */
export function TableResultCount({
  count,
  total,
  isFiltered = false,
  noun = ["resultado", "resultados"],
  className,
}: TableResultCountProps) {
  const label = count === 1 ? noun[0] : noun[1];
  const showTotal = isFiltered && total !== undefined && total !== count;

  return (
    <p
      aria-live="polite"
      className={cn("text-sm whitespace-nowrap text-muted-foreground", className)}
    >
      {showTotal
        ? `${numberFormat.format(count)} de ${numberFormat.format(total)} ${label}`
        : `${numberFormat.format(count)} ${label}`}
    </p>
  );
}
