"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Hoy", href: "/today", icon: Home },
  { label: "Cartera", href: "/portfolio", icon: BriefcaseBusiness },
  { label: "Vencimientos", href: "/due-payments", icon: CalendarClock },
  { label: "Renovaciones", href: "/renewals", icon: ShieldCheck },
  { label: "Pendientes", href: "/tasks", icon: CheckSquare },
  { label: "Siniestros", href: "/claims", icon: AlertTriangle },
  { label: "Clientes", href: "/clients", icon: Users },
  { label: "Polizas", href: "/policies", icon: FolderKanban },
  { label: "Cotizaciones", href: "/quotes", icon: Calculator },
  { label: "Aseguradoras", href: "/insurers", icon: Building2 },
  { label: "Recibos", href: "/receipts", icon: ReceiptText },
  { label: "Comisiones", href: "/commissions", icon: CircleDollarSign },
  { label: "Documentos", href: "/documents", icon: FileText },
  { label: "Riesgos", href: "/risks", icon: AlertTriangle },
  { label: "Reportes", href: "/reports", icon: BarChart3 },
  { label: "Calidad", href: "/data-quality", icon: BadgeCheck },
  { label: "Configuracion", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-sidebar-border/80 bg-sidebar/85 p-4 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-3xl border bg-white/72 p-3 shadow-sm">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">PolicyDesk</p>
            <p className="text-xs text-muted-foreground">Cockpit de seguros</p>
          </div>
        </Link>

        <div className="mt-5 rounded-2xl border bg-white/55 p-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search className="size-4" />
            Buscar cliente, poliza, recibo...
          </div>
        </div>

        <nav className="mt-5 space-y-1 overflow-y-auto pr-1">
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/72 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-white text-primary shadow-sm ring-1 ring-border/70",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-3xl border bg-white/62 p-4 shadow-sm">
          <p className="text-sm font-semibold">Operaciones locales</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            SQLite, documentos privados y backups seguros en `data/`.
          </p>
        </div>
      </div>
    </aside>
  );
}

