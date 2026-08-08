import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type LoadingSkeletonVariant = "table" | "card" | "drawer" | "command"

export type LoadingSkeletonProps = {
  variant?: LoadingSkeletonVariant
  rows?: number
  /** Number of columns the real table renders, so the placeholder matches it. */
  columns?: number
  className?: string
}

/** Staggered widths keep the placeholder from reading as a solid block. */
const cellWidths = ["w-3/4", "w-5/6", "w-2/3", "w-4/5", "w-1/2", "w-11/12"]

function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const columnCount = Math.max(1, Math.min(columns, 12))
  const gridStyle = { gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Cargando tabla"
      className="overflow-hidden rounded-xl border bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-56 rounded-md" />
        <div className="space-y-2">
          <div className="grid gap-3" style={gridStyle}>
            {Array.from({ length: columnCount }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid gap-3 rounded-md border border-dashed border-border/60 p-3"
              style={gridStyle}
            >
              {Array.from({ length: columnCount }).map((_, columnIndex) => (
                <Skeleton
                  key={columnIndex}
                  className={`h-4 ${cellWidths[(rowIndex + columnIndex) % cellWidths.length]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
      </div>
    </div>
  )
}

function DrawerSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CommandSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-2 ring-1 ring-foreground/10">
      <Skeleton className="h-9 w-full rounded-md" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-2 rounded-md px-2 py-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingSkeleton({ variant = "card", rows = 5, columns, className }: LoadingSkeletonProps) {
  const content =
    variant === "table" ? (
      <TableSkeleton rows={rows} columns={columns} />
    ) : variant === "drawer" ? (
      <DrawerSkeleton rows={rows} />
    ) : variant === "command" ? (
      <CommandSkeleton rows={rows} />
    ) : (
      <CardSkeleton />
    )

  return <div className={cn("w-full", className)}>{content}</div>
}

export { LoadingSkeleton }
