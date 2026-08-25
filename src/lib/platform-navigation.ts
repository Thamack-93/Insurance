import type { LucideIcon } from "@/components/icons";
import { Activity, Building2, CreditCard, Database, LayoutDashboard, UserRound } from "lucide-react";

export type PlatformNavigationItem = {
  id: "overview" | "organizations" | "billing" | "backups" | "integrations" | "account";
  label: string;
  href: string;
  icon: LucideIcon;
};

export const platformNavigation: PlatformNavigationItem[] = [
  { id: "overview", label: "Resumen", href: "/platform", icon: LayoutDashboard },
  { id: "organizations", label: "Organizaciones", href: "/platform/organizations", icon: Building2 },
  { id: "billing", label: "Facturación", href: "/platform/billing", icon: CreditCard },
  { id: "backups", label: "Respaldos", href: "/platform/backups", icon: Database },
  { id: "integrations", label: "Integraciones", href: "/platform/integrations", icon: Activity },
];

export const platformUtilityNavigation: PlatformNavigationItem[] = [
  { id: "account", label: "Mi cuenta", href: "/platform/account", icon: UserRound },
];

function normalize(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function matches(pathname: string, href: string) {
  const current = normalize(pathname);
  const target = normalize(href);
  return current === target || current.startsWith(`${target}/`);
}

export function isPlatformNavigationItemActive(item: PlatformNavigationItem, pathname: string) {
  if (item.id === "overview") return normalize(pathname) === "/platform";
  return matches(pathname, item.href);
}

export function getPlatformNavigationItem(pathname: string) {
  return [...platformNavigation, ...platformUtilityNavigation]
    .filter((item) => isPlatformNavigationItemActive(item, pathname))
    .sort((left, right) => right.href.length - left.href.length)[0];
}

const platformBreadcrumbLabels: Record<string, string> = {
  account: "Mi cuenta",
  backups: "Respaldos",
  billing: "Facturación",
  integrations: "Integraciones",
  new: "Nueva organización",
  organizations: "Organizaciones",
  platform: "Resumen",
};

export function getPlatformBreadcrumbSegments(pathname: string) {
  const segments = normalize(pathname)
    .split("/")
    .filter(Boolean)
    .map((segment) => ({ segment, label: platformBreadcrumbLabels[segment] ?? (segment.startsWith("org_") ? "Detalle" : segment) }));
  return segments[0]?.segment === "platform" ? segments.slice(1) : segments;
}
