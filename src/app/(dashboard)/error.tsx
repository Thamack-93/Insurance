"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <main
      role="alert"
      aria-live="assertive"
      className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-12 md:px-6 lg:px-8"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-5 rounded-3xl border bg-white/80 p-8 text-center shadow-sm">
        <div className="rounded-3xl border bg-rose-50 p-4 text-rose-600">
          <AlertTriangle className="size-7" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Algo salió mal en esta sección
          </h1>
          <p className="text-sm text-muted-foreground">
            No pudimos cargar la información. Puedes intentarlo de nuevo o volver al inicio.
          </p>
          {error.digest ? (
            <p className="text-xs text-muted-foreground/80">
              Referencia: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => reset()} className="rounded-full">
            <RefreshCcw className="mr-2 size-4" aria-hidden />
            Reintentar
          </Button>
          <Button asChild variant="outline" className="rounded-full bg-white/80">
            <Link href="/dashboard">Volver al panel</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
