import type { LucideIcon } from "@/components/icons";
import {
  BarChart3,
  Calculator,
  FolderKanban,
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
  redirectAliases?: string[];
  activePaths?: string[];
};

export type UtilityNavigationItem = {
  id: "administration" | "profile";
  label: string;
  href: string;
  icon: LucideIcon;
  requiresAdmin?: boolean;
};

export const globalNavigation: GlobalNavigationItem[] = [
  { id: "today", label: "Hoy", href: "/today", icon: Home, redirectAliases: ["/dashboard"] },
  {
    id: "operations",
    label: "Operación",
    href: "/operations",
    icon: ShieldCheck,
    redirectAliases: ["/tasks", "/renewals", "/claims"],
  },
  { id: "clients", label: "Clientes", href: "/clients", icon: Users },
  { id: "policies", label: "Pólizas", href: "/policies", icon: FileText, activePaths: ["/quotes"] },
  {
    id: "receipts",
    label: "Recibos",
    href: "/receipts",
    icon: ReceiptText,
    redirectAliases: ["/due-payments"],
    activePaths: ["/payments"],
  },
  { id: "commissions", label: "Comisiones y bonos", href: "/commissions", icon: CircleDollarSign },
  { id: "reports", label: "Reportes", href: "/reports", icon: BarChart3, activePaths: ["/portfolio"] },
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

const contextualBreadcrumbLabels: Record<string, Record<string, string>> = {
  reports: {
    collections: "Cobranza",
    renewals: "Renovaciones",
    portfolio: "Reporte de cartera",
    commissions: "Comisiones",
    operations: "Operación",
  },
  today: {
    insights: "Insights",
  },
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
  const candidates = [item.href, ...(item.activePaths ?? []), ...(item.redirectAliases ?? [])];
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

export function getBreadcrumbSegments(pathname: string, searchParams?: { get(name: string): string | null }) {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname
    .split("/")
    .filter(Boolean)
    .map((segment) => ({ segment, label: breadcrumbLabels[segment] ?? segment }));

  const rootSegment = segments[0]?.segment;
  const view = searchParams?.get("view");
  const contextualLabel = rootSegment && view ? contextualBreadcrumbLabels[rootSegment]?.[view] : undefined;
  if (contextualLabel && view) segments.push({ segment: view, label: contextualLabel });

  return segments;
}

export type LocalNavigationItem = {
  label: string;
  href: string;
  excludeQueryKeys?: string[];
  activeHrefs?: string[];
};

export function isLocalNavigationItemActive(
  item: LocalNavigationItem,
  pathname: string,
  searchParams: { get(name: string): string | null },
) {
  return [item.href, ...(item.activeHrefs ?? [])].some((href) => {
    const [itemPathname, itemQuery = ""] = href.split("?");
    const expectedParams = new URLSearchParams(itemQuery);
    return pathname === itemPathname
      && [...expectedParams].every(([key, value]) => searchParams.get(key) === value)
      && (item.excludeQueryKeys ?? []).every((key) => !searchParams.get(key));
  });
}

export const policyNavigation: LocalNavigationItem[] = [
  { label: "Activas", href: "/policies?status=ACTIVE" },
  { label: "Por vencer", href: "/operations?view=renewals" },
  { label: "Cotizaciones", href: "/quotes" },
  { label: "Archivadas", href: "/policies?status=ARCHIVED" },
];

export const todayNavigation: LocalNavigationItem[] = [
  { label: "Mi día", href: "/today", excludeQueryKeys: ["view"] },
  { label: "Insights", href: "/today?view=insights" },
];

export const reportsNavigation: LocalNavigationItem[] = [
  { label: "Reportes", href: "/reports", excludeQueryKeys: ["view"] },
  { label: "Cartera", href: "/portfolio" },
  { label: "Cobranza", href: "/reports?view=collections" },
  { label: "Renovaciones", href: "/reports?view=renewals" },
  { label: "Reporte de cartera", href: "/reports?view=portfolio" },
  { label: "Comisiones", href: "/reports?view=commissions" },
  { label: "Operación", href: "/reports?view=operations" },
];

export const contextualNavigation = [
  { id: "quotes", label: "Cotizaciones", href: "/quotes", icon: Calculator },
  { id: "portfolio", label: "Cartera", href: "/portfolio", icon: FolderKanban },
  { id: "insights", label: "Insights", href: "/today?view=insights", icon: BarChart3 },
] as const;
