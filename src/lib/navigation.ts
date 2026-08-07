import type { LucideIcon } from "@/components/icons";
import {
  BarChart3,
  CircleDollarSign,
  FileText,
  Home,
  ReceiptText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "@/components/icons";

export type GlobalNavigationId =
  | "today"
  | "operations"
  | "clients"
  | "policies"
  | "receipts"
  | "commissions"
  | "reports";

export type GlobalNavigationItem = {
  id: GlobalNavigationId;
  label: string;
  href: string;
  icon: LucideIcon;
  aliases?: string[];
};

export type UtilityNavigationItem = {
  id: "administration" | "profile";
  label: string;
  href: string;
  icon: LucideIcon;
  requiresAdmin?: boolean;
};

export const globalNavigation: GlobalNavigationItem[] = [
  { id: "today", label: "Hoy", href: "/today", icon: Home, aliases: ["/dashboard"] },
  {
    id: "operations",
    label: "Operación",
    href: "/operations",
    icon: ShieldCheck,
    aliases: ["/tasks", "/renewals", "/claims"],
  },
  { id: "clients", label: "Clientes", href: "/clients", icon: Users },
  { id: "policies", label: "Pólizas", href: "/policies", icon: FileText, aliases: ["/quotes"] },
  {
    id: "receipts",
    label: "Recibos",
    href: "/receipts",
    icon: ReceiptText,
    aliases: ["/due-payments", "/payments"],
  },
  { id: "commissions", label: "Comisiones y bonos", href: "/commissions", icon: CircleDollarSign },
  { id: "reports", label: "Reportes", href: "/reports", icon: BarChart3, aliases: ["/portfolio"] },
];

export const utilityNavigation: UtilityNavigationItem[] = [
  { id: "administration", label: "Administración", href: "/settings", icon: Settings, requiresAdmin: true },
  { id: "profile", label: "Perfil", href: "/settings/account", icon: UserRound },
];

const breadcrumbLabels: Record<string, string> = {
  activity: "Auditoría",
  assistant: "Nora",
  claims: "Siniestros",
  clients: "Clientes",
  commissions: "Comisiones y bonos",
  dashboard: "Insights",
  "data-quality": "Calidad de datos",
  documents: "Documentos",
  "due-payments": "Recibos",
  insurers: "Aseguradoras",
  notifications: "Notificaciones",
  operations: "Operación",
  payments: "Pagos",
  policies: "Pólizas",
  portfolio: "Cartera",
  quotes: "Cotizaciones",
  receipts: "Recibos",
  renewals: "Renovaciones",
  reports: "Reportes",
  risks: "Riesgos",
  settings: "Configuración",
  tasks: "Pendientes",
  today: "Hoy",
};

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function matchesPath(pathname: string, href: string) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedHref = normalizePathname(href);
  return normalizedPathname === normalizedHref || normalizedPathname.startsWith(`${normalizedHref}/`);
}

export function isNavigationItemActive(item: GlobalNavigationItem, pathname: string) {
  const candidates = [item.href, ...(item.aliases ?? [])];
  return candidates.some((href) => matchesPath(pathname, href));
}

export function getPrimaryNavigationItem(pathname: string): GlobalNavigationItem | undefined {
  return globalNavigation.find((item) => isNavigationItemActive(item, pathname));
}

export function getPrimaryNavigationId(pathname: string): GlobalNavigationId | undefined {
  return getPrimaryNavigationItem(pathname)?.id;
}

export function getUtilityNavigation(isAdmin: boolean) {
  return utilityNavigation.filter((item) => !item.requiresAdmin || isAdmin);
}

export function getActiveUtilityNavigationItem(pathname: string) {
  return utilityNavigation
    .filter((item) => matchesPath(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

export function isUtilityNavigationItemActive(item: UtilityNavigationItem, pathname: string) {
  return getActiveUtilityNavigationItem(pathname)?.id === item.id;
}

export function getBreadcrumbSegments(pathname: string) {
  return normalizePathname(pathname)
    .split("/")
    .filter(Boolean)
    .map((segment) => ({ segment, label: breadcrumbLabels[segment] ?? segment }));
}

export type LocalNavigationItem = {
  label: string;
  href: string;
  excludeQueryKeys?: string[];
};
