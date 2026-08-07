"use client"

import * as React from "react"
import {
  type Cell,
  type ColumnDef,
  type FilterFn,
  type Row,
  type RowData,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { parseSearchQuery, valueSearchVariants, variantsMatchQuery } from "@/lib/table-search"
import { cn } from "@/lib/utils"
import { RecordCards, type RecordCardField, type RecordCardItem } from "./record-cards"
import { TableResultCount } from "./table-result-count"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /**
     * Text the user actually sees for this column. Declare it whenever the cell
     * renders something other than the raw value (a label, a joined string, a
     * badge), so the search box matches the screen and not the database.
     */
    searchText?: (row: TData) => string | string[]
    /** Where the column lands on the narrow-screen card. */
    mobile?: "title" | "subtitle" | "badge" | "field" | "hidden"
    /** Label used on the narrow-screen card; falls back to the header text. */
    mobileLabel?: string
  }
}

export type TableDensity = "comfortable" | "compact" | "spacious"

export type DataTableProps<TData extends object> = {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  className?: string
  toolbar?: React.ReactNode
  density?: TableDensity
  searchPlaceholder?: string
  /** Shown when the table has no data at all. */
  emptyTitle?: string
  emptyDescription?: string
  /** Singular/plural noun for the result count. */
  resultNoun?: [string, string]
  /** Accessible name for the narrow-screen card list. */
  cardsLabel?: string
  /** Row link target used by the narrow-screen cards. */
  getRowHref?: (row: TData) => string | undefined
}

const densityClasses: Record<TableDensity, { head: string; cell: string; row: string }> = {
  comfortable: {
    head: "h-10 px-2",
    cell: "px-2 py-2",
    row: "text-sm",
  },
  compact: {
    head: "h-9 px-2",
    cell: "px-2 py-1.5 text-xs",
    row: "text-xs",
  },
  spacious: {
    head: "h-12 px-3",
    cell: "px-3 py-3",
    row: "text-sm",
  },
}

function headerText(cell: Cell<never, unknown>["column"]): string {
  const header = cell.columnDef.header
  return typeof header === "string" ? header : cell.id
}

function DataTable<TData extends object>({
  columns,
  data,
  className,
  toolbar,
  density = "comfortable",
  searchPlaceholder = "Buscar en la tabla",
  emptyTitle = "Aún no hay registros",
  emptyDescription = "Cuando se registre información aparecerá en esta tabla.",
  resultNoun = ["resultado", "resultados"],
  cardsLabel = "Registros",
  getRowHref,
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState("")

  /**
   * Matches against every textual shape the value takes on screen — a premium
   * stored as `12500` is reachable by typing `$12,500`, and a date stored as a
   * timestamp is reachable by typing `05/03/2026`.
   */
  const globalFilterFn: FilterFn<TData> = (row, _columnId, filterValue) => {
    const parsed = parseSearchQuery(String(filterValue ?? ""))

    if (!parsed.text) return true

    return row.getAllCells().some((cell) => {
      const declared = cell.column.columnDef.meta?.searchText?.(row.original)
      const variants = declared
        ? (Array.isArray(declared) ? declared : [declared])
        : valueSearchVariants(cell.getValue())

      return variantsMatchQuery(variants, parsed)
    })
  }

  // TanStack Table exposes stable methods that the React hooks lint rule flags conservatively.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      globalFilter,
    },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const densityPreset = densityClasses[density]
  const rows = table.getRowModel().rows
  const isFiltered = globalFilter.trim().length > 0
  const hasNoData = data.length === 0

  const cards: RecordCardItem[] = rows.map((row: Row<TData>) => {
    const cells = row.getVisibleCells()
    let title: React.ReactNode = null
    let subtitle: React.ReactNode = null
    let badge: React.ReactNode = null
    const fields: RecordCardField[] = []

    cells.forEach((cell, index) => {
      const placement = cell.column.columnDef.meta?.mobile ?? (index === 0 ? "title" : "field")
      if (placement === "hidden") return

      const content = flexRender(cell.column.columnDef.cell, cell.getContext())

      if (placement === "title" && title === null) {
        title = content
        return
      }
      if (placement === "subtitle" && subtitle === null) {
        subtitle = content
        return
      }
      if (placement === "badge" && badge === null) {
        badge = content
        return
      }

      fields.push({
        label: cell.column.columnDef.meta?.mobileLabel ?? headerText(cell.column as never),
        value: content,
      })
    })

    return {
      id: row.id,
      title: title ?? "—",
      subtitle,
      badge,
      fields,
      href: getRowHref?.(row.original),
    }
  })

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full sm:max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/40"
            />
          </div>
          <TableResultCount
            count={rows.length}
            total={data.length}
            isFiltered={isFiltered}
            noun={resultNoun}
          />
        </div>
        {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10">
        {rows.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <div className="font-heading text-base font-medium text-foreground">
              {hasNoData ? emptyTitle : "Sin coincidencias"}
            </div>
            <p className="max-w-sm text-sm text-muted-foreground">
              {hasNoData
                ? emptyDescription
                : "Ningún registro coincide con lo que buscaste. Ajusta o limpia la búsqueda para ver todo de nuevo."}
            </p>
            {hasNoData ? null : (
              <Button variant="outline" size="sm" onClick={() => setGlobalFilter("")}>
                Limpiar búsqueda
              </Button>
            )}
          </div>
        ) : (
          <>
            <RecordCards items={cards} label={cardsLabel} />
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className={cn("hover:bg-transparent", densityPreset.row)}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className={cn("font-medium", densityPreset.head)}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined} className={densityPreset.row}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={densityPreset.cell}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export { DataTable }
