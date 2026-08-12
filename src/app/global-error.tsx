"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global app error:", error);
  }, [error]);

  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground">
        <main
          role="alert"
          aria-live="assertive"
          className="grid min-h-screen place-items-center px-4 py-12"
        >
          <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-md border bg-card p-6 text-center shadow-sm">
            <div className="rounded-md border bg-rose-50 p-3 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="size-6" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold tracking-tight">No pudimos cargar esta vista</h1>
              <p className="text-sm text-muted-foreground">
                Intenta recargar. Si vuelve a pasar, ya tenemos una referencia para rastrearlo.
              </p>
              {error.digest ? (
                <p className="text-xs text-muted-foreground">
                  Referencia: <span className="font-mono">{error.digest}</span>
                </p>
              ) : null}
            </div>
            <Button type="button" onClick={reset}>
              <RefreshCcw className="mr-2 size-4" aria-hidden />
              Reintentar
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
