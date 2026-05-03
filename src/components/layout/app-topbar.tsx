"use client";

import { usePathname } from "next/navigation";
import { Bell, CalendarDays, Command } from "lucide-react";
import { SearchInput } from "@/components/search/search-input";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  today: "Hoy",
  portfolio: "Cartera",
  "due-payments": "Vencimientos",
  renewals: "Renovaciones",
  tasks: "Pendientes",
  claims: "Siniestros",
  clients: "Clientes",
  policies: "Pólizas",
  quotes: "Cotizaciones",
  insurers: "Aseguradoras",
  receipts: "Recibos",
  commissions: "Comisiones",
  documents: "Documentos",
  risks: "Riesgos",
  reports: "Reportes",
  settings: "Configuración",
  "data-quality": "Calidad de datos",
};

export function AppTopbar() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-4 px-5 lg:px-8">
        <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex shrink-0">
          <span>PG</span>
          {segments.map((segment) => (
            <span key={segment} className="flex items-center gap-2">
              <span>/</span>
              <span className="font-medium text-foreground">{labels[segment] ?? segment}</span>
            </span>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 shadow-sm">
          <SearchInput />
          <button
            type="button"
            aria-label="Abrir paleta de comandos"
            onClick={() => window.dispatchEvent(new CustomEvent("pg:open-command-palette"))}
            className="hidden items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted/80 sm:flex shrink-0 cursor-pointer"
          >
            <Command className="size-3" /> K
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <Button
            variant="outline"
            size="icon"
            aria-label="Abrir calendario"
            className="rounded-full bg-card/75"
          >
            <CalendarDays className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Ver notificaciones"
            className="rounded-full bg-card/75"
          >
            <Bell className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
