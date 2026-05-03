export function SectionSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Cargando contenido"
      className="space-y-3"
    >
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="h-12 animate-pulse rounded-2xl border border-stone-200/70 bg-stone-100/60"
        />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded-full bg-stone-200/70" />
          <div className="h-8 w-1/3 animate-pulse rounded-2xl bg-stone-200/70" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-stone-200/60" />
        </div>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-3xl border bg-white/70" />
          ))}
        </section>
        <SectionSkeleton rows={8} />
      </div>
    </main>
  );
}
