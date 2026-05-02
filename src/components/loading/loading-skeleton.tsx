import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type LoadingSkeletonVariant = "table" | "card" | "drawer" | "command"

export type LoadingSkeletonProps = {
  variant?: LoadingSkeletonVariant
  rows?: number
  className?: string
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card p-4 ring-1 ring-foreground/10">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56 rounded-lg" />
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="grid grid-cols-4 gap-3 rounded-lg border border-dashed border-border/60 p-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
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
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
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
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CommandSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-card p-2 ring-1 ring-foreground/10">
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-2 rounded-lg px-2 py-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function LoadingSkeleton({ variant = "card", rows = 5, className }: LoadingSkeletonProps) {
  const content =
    variant === "table" ? (
      <TableSkeleton rows={rows} />
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
