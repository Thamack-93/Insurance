"use client";

import { usePathname } from "next/navigation";
import { Bell, CalendarDays, Command, Search } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { CommandPaletteWrapper } from "@/components/command/command-palette-wrapper";
import { SearchInput } from "@/components/search/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const labels: Record<string, string> = {
  dashboard: "Dashboard",
  today: "Hoy",
  portfolio: "Cartera",
  "due-payments": "Vencimientos",
  renewals: "Renovaciones",
  tasks: "Pendientes",
  claims: "Siniestros",
  clients: "Clientes",
  policies: "Polizas",
  quotes: "Cotizaciones",
  insurers: "Aseguradoras",
  receipts: "Recibos",
  commissions: "Comisiones",
  documents: "Documentos",
  risks: "Riesgos",
  reports: "Reportes",
  settings: "Configuracion",
  "data-quality": "Calidad de datos",
};

export function AppTopbar() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/78 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-4 px-5 lg:px-8">
        <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
          <span>PG</span>
          {segments.map((segment) => (
            <span key={segment} className="flex items-center gap-2">
              <span>/</span>
              <span className="font-medium text-foreground">{labels[segment] ?? segment}</span>
            </span>
          ))}
        </div>

        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full border bg-white/80 px-3 py-1.5 shadow-sm">
          <Search className="size-4 text-muted-foreground" />
          <SearchInput />
          <div className="hidden items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs text-muted-foreground sm:flex">
            <Command className="size-3" /> K
          </div>
        </div>

        <Button variant="outline" size="icon" className="rounded-full bg-white/75">
          <CalendarDays className="size-4" />
        </Button>
        <Button variant="outline" size="icon" className="rounded-full bg-white/75">
          <Bell className="size-4" />
        </Button>
      </div>
    </header>
  );
}
