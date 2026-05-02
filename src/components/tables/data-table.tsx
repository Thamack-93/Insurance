"use client"

import * as React from "react"
import {
  type ColumnDef,
  type FilterFn,
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
import { cn } from "@/lib/utils"

export type TableDensity = "comfortable" | "compact" | "spacious"

export type DataTableProps<TData extends object> = {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  className?: string
  toolbar?: React.ReactNode
  density?: TableDensity
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
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

function DataTable<TData extends object>({
  columns,
  data,
  className,
  toolbar,
  density = "comfortable",
  searchPlaceholder = "Buscar en la tabla",
  emptyTitle = "Sin resultados",
  emptyDescription = "No hay registros que coincidan con los filtros actuales.",
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = React.useState("")
  const globalFilterFn: FilterFn<TData> = (row, _columnId, filterValue) => {
    const search = String(filterValue ?? "").trim().toLowerCase()

    if (!search) return true

    return row.getAllCells().some((cell) => {
      const value = cell.getValue()

      if (value === null || value === undefined) return false

      return String(value).toLowerCase().includes(search)
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

  const leafColumns = Math.max(1, table.getAllLeafColumns().length)
  const densityPreset = densityClasses[density]

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/40"
          />
        </div>
        {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10">
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined} className={densityPreset.row}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={densityPreset.cell}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={leafColumns} className="p-0">
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                    <div className="font-heading text-base font-medium text-foreground">{emptyTitle}</div>
                    <p className="max-w-sm text-sm text-muted-foreground">{emptyDescription}</p>
                    {globalFilter ? (
                      <Button variant="outline" size="sm" onClick={() => setGlobalFilter("")}>
                        Limpiar búsqueda
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export { DataTable }
