"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Home,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarClock,
  ShieldCheck,
  CheckSquare,
  Users,
  FolderKanban,
  ReceiptText,
  CircleDollarSign,
  FileText,
  AlertTriangle,
  BarChart3,
  BadgeCheck,
  Settings,
  Plus,
  Clock,
} from "lucide-react";
import { CommandPalette } from "./command-palette";
import { getRecentItems, RECENTLY_VIEWED_EVENT, type RecentItem } from "@/lib/recently-viewed";

export function CommandPaletteWrapper() {
  const [open, setOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const router = useRouter();

  const handleSelect = useCallback((href: string) => {
    router.push(href);
    setOpen(false);
  }, [router]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("pg:open-command-palette", openHandler);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("pg:open-command-palette", openHandler);
    };
  }, []);

  useEffect(() => {
    setRecentItems(getRecentItems());
    const handler = () => setRecentItems(getRecentItems());
    window.addEventListener("storage", handler);
    window.addEventListener(RECENTLY_VIEWED_EVENT, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(RECENTLY_VIEWED_EVENT, handler);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setRecentItems(getRecentItems());
    }
  }, [open]);

  const recentGroup = recentItems.length > 0
    ? [{
        label: "Vistos recientemente",
        items: recentItems.map((item) => ({
          id: `recent-${item.id}`,
          label: item.label,
          description: item.type,
          icon: <Clock className="size-4" />,
          onSelect: () => handleSelect(item.href),
        })),
      }]
    : [];

  const groups = [
    ...recentGroup,
    {
      label: "Vistas principales",
      items: [
        { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" />, onSelect: () => handleSelect("/dashboard") },
        { id: "today", label: "Hoy", icon: <Home className="size-4" />, onSelect: () => handleSelect("/today") },
        { id: "portfolio", label: "Cartera", icon: <BriefcaseBusiness className="size-4" />, onSelect: () => handleSelect("/portfolio") },
      ],
    },
    {
      label: "Operación",
      items: [
        { id: "due-payments", label: "Vencimientos", icon: <CalendarClock className="size-4" />, onSelect: () => handleSelect("/due-payments") },
        { id: "renewals", label: "Renovaciones", icon: <ShieldCheck className="size-4" />, onSelect: () => handleSelect("/renewals") },
        { id: "tasks", label: "Pendientes", icon: <CheckSquare className="size-4" />, onSelect: () => handleSelect("/tasks") },
        { id: "claims", label: "Siniestros", icon: <AlertTriangle className="size-4" />, onSelect: () => handleSelect("/claims") },
      ],
    },
    {
      label: "CRM",
      items: [
        { id: "clients", label: "Clientes", icon: <Users className="size-4" />, onSelect: () => handleSelect("/clients") },
        { id: "policies", label: "Pólizas", icon: <FolderKanban className="size-4" />, onSelect: () => handleSelect("/policies") },
        { id: "quotes", label: "Cotizaciones", icon: <Calculator className="size-4" />, onSelect: () => handleSelect("/quotes") },
        { id: "insurers", label: "Aseguradoras", icon: <Building2 className="size-4" />, onSelect: () => handleSelect("/insurers") },
        { id: "receipts", label: "Recibos", icon: <ReceiptText className="size-4" />, onSelect: () => handleSelect("/receipts") },
      ],
    },
    {
      label: "Finanzas y calidad",
      items: [
        { id: "commissions", label: "Comisiones", icon: <CircleDollarSign className="size-4" />, onSelect: () => handleSelect("/commissions") },
        { id: "documents", label: "Documentos", icon: <FileText className="size-4" />, onSelect: () => handleSelect("/documents") },
        { id: "risks", label: "Riesgos", icon: <AlertTriangle className="size-4" />, onSelect: () => handleSelect("/risks") },
        { id: "reports", label: "Reportes", icon: <BarChart3 className="size-4" />, onSelect: () => handleSelect("/reports") },
        { id: "data-quality", label: "Calidad de datos", icon: <BadgeCheck className="size-4" />, onSelect: () => handleSelect("/data-quality") },
      ],
    },
    {
      label: "Acciones rápidas",
      items: [
        { id: "new-client", label: "Nuevo cliente", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/clients/new") },
        { id: "new-policy", label: "Nueva póliza", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/policies/new") },
        { id: "new-task", label: "Nuevo pendiente", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/tasks/new") },
        { id: "new-receipt", label: "Nuevo recibo", icon: <Plus className="size-4" />, onSelect: () => handleSelect("/receipts/new") },
      ],
    },
    {
      label: "Sistema",
      items: [
        { id: "settings", label: "Configuración", icon: <Settings className="size-4" />, onSelect: () => handleSelect("/settings") },
      ],
    },
  ];

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      groups={groups}
      placeholder="Buscar páginas, crear registros..."
      title="Command Palette"
      description="Navegación rápida y acciones de PG"
    />
  );
}
