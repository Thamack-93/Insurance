import { AlertTriangle } from "lucide-react";

export function DeploymentUnavailable() {
  return (
    <main className="min-h-screen bg-background px-4 py-16" role="alert" aria-live="assertive">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Configuración de base de datos no disponible</h1>
          <p className="text-sm text-muted-foreground">
            PolicyDesk bloqueó el acceso para proteger los datos. Un operador debe verificar la identidad del despliegue y de la base conectada.
          </p>
        </div>
      </div>
    </main>
  );
}
