"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { globalNavigation, isNavigationItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navigationGroups = [
  { label: "Trabajo", ids: ["today", "operations"] },
  { label: "Cartera", ids: ["clients", "policies"] },
  { label: "Finanzas", ids: ["receipts", "commissions"] },
  { label: "Análisis", ids: ["reports"] },
] as const;

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegación principal" className="space-y-1">
      {navigationGroups.map((group) => {
        const groupItems = group.ids
          .map((id) => globalNavigation.find((item) => item.id === id))
          .filter((item): item is (typeof globalNavigation)[number] => Boolean(item));

        return (
          <div key={group.label} className="space-y-1">
            {!collapsed ? <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground first:pt-0">{group.label}</p> : null}
            {groupItems.map((item) => {
              const Icon = item.icon;
              const active = isNavigationItemActive(item, pathname);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className={cn("size-[18px] shrink-0", active && "text-sidebar-primary")} aria-hidden />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );

              if (!collapsed) return <div key={item.id}>{link}</div>;
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger render={link} />
                  <TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
