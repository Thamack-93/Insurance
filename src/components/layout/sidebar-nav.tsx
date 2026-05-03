"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  CircleDollarSign,
  FileText,
  FolderKanban,
  Home,
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavSection = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: NavItem[];
};

export const sections: NavSection[] = [
  {
    id: "operacion",
    label: "Operación",
    defaultOpen: true,
    items: [
      { label: "Hoy", href: "/today", icon: Home },
      { label: "Pendientes", href: "/tasks", icon: CheckSquare },
      { label: "Vencimientos", href: "/due-payments", icon: CalendarClock },
      { label: "Renovaciones", href: "/renewals", icon: ShieldCheck },
      { label: "Siniestros", href: "/claims", icon: AlertTriangle },
    ],
  },
  {
    id: "cartera",
    label: "Cartera",
    defaultOpen: true,
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Cartera", href: "/portfolio", icon: BriefcaseBusiness },
      { label: "Clientes", href: "/clients", icon: Users },
      { label: "Pólizas", href: "/policies", icon: FolderKanban },
      { label: "Cotizaciones", href: "/quotes", icon: Calculator },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    defaultOpen: true,
    items: [
      { label: "Recibos y pagos", href: "/receipts", icon: ReceiptText },
      { label: "Comisiones", href: "/commissions", icon: CircleDollarSign },
    ],
  },
  {
    id: "operacion-interna",
    label: "Operación interna",
    defaultOpen: false,
    items: [
      { label: "Aseguradoras", href: "/insurers", icon: Building2 },
      { label: "Documentos", href: "/documents", icon: FileText },
    ],
  },
  {
    id: "calidad",
    label: "Calidad",
    defaultOpen: false,
    items: [
      { label: "Notificaciones", href: "/notifications", icon: Bell },
      { label: "Riesgos y calidad", href: "/risks", icon: BadgeCheck },
      { label: "Reportes", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    defaultOpen: false,
    items: [{ label: "Configuración", href: "/settings", icon: Settings }],
  },
];

const STORAGE_KEY = "pg.sidebar.openSections";

function readStoredState(): Record<string, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, boolean>;
  } catch {
    return null;
  }
  return null;
}

function defaultOpenState() {
  return Object.fromEntries(sections.map((section) => [section.id, section.defaultOpen ?? true]));
}

export function SidebarItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium text-sidebar-foreground/72 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border/70",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(defaultOpenState);

  useEffect(() => {
    const stored = readStoredState();
    if (stored) {
      setOpenMap((prev) => ({ ...prev, ...stored }));
    }
  }, []);

  useEffect(() => {
    const activeSection = sections.find((section) =>
      section.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
    );
    if (activeSection && !openMap[activeSection.id]) {
      setOpenMap((prev) => ({ ...prev, [activeSection.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleSection = (id: string) => {
    setOpenMap((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };

  return (
    <nav className="flex-1 space-y-3 overflow-y-auto pr-1">
      {sections.map((section) => {
        const open = openMap[section.id] ?? section.defaultOpen ?? true;
        const sectionActive = section.items.some(
          (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
        );

        return (
          <div key={section.id}>
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground",
                sectionActive && "text-foreground",
              )}
              aria-expanded={open}
            >
              <span>{section.label}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  open ? "rotate-0" : "-rotate-90",
                )}
              />
            </button>
            {open ? (
              <div className="mt-1 space-y-1">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarItem
                      key={item.href}
                      item={item}
                      active={active}
                      onNavigate={onNavigate}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
