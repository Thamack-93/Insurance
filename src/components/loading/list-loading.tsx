import { Skeleton } from "@/components/ui/skeleton";
import { LoadingSkeleton } from "./loading-skeleton";

export type ListLoadingProps = {
  /** Columns the real table renders, so the placeholder matches its shape. */
  columns?: number;
  /** Rows the real table shows on a full page. */
  rows?: number;
  /** Metric cards above the table. */
  metrics?: number;
};

export function ListLoading({ columns = 6, rows = 8, metrics = 4 }: ListLoadingProps) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </header>
        {metrics > 0 ? (
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: metrics }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 rounded-xl" />
            ))}
          </section>
        ) : null}
        <LoadingSkeleton variant="table" columns={columns} rows={rows} />
      </div>
    </main>
  );
}
