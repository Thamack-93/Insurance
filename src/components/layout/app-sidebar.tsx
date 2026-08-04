"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ShieldCheck, type LucideIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./sidebar-nav";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getUtilityNavigation, isUtilityNavigationItemActive } from "@/lib/navigation";

const SIDEBAR_STORAGE_KEY = "policydesk.sidebar.collapsed";

export function AppSidebar({ isAdmin, isSuperAdmin = false }: { isAdmin: boolean; isSuperAdmin?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const utilities = getUtilityNavigation(isAdmin, isSuperAdmin);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
      } catch {
        // Storage is optional; expanded remains the accessible default.
      }
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next)); } catch { /* optional */ }
  }, [collapsed]);

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-white/10 bg-[#06283b] text-white transition-[width] duration-200 lg:block",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className="flex h-full flex-col px-3 py-4">
          <div className="flex items-center justify-between gap-2">
            <Link
              href="/today"
              aria-label="PolicyDesk, ir a Hoy"
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
                collapsed && "justify-center px-0",
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-[#06283b]">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              {!collapsed ? <span className="text-[15px] font-semibold tracking-tight">PolicyDesk</span> : null}
            </Link>
            {!collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Colapsar menú lateral"
                className="grid size-9 place-items-center rounded-lg text-slate-300 hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {collapsed ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label="Expandir menú lateral"
                    className="mt-2 grid min-h-10 w-full place-items-center rounded-lg text-slate-300 hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  />
                }
              >
                <ChevronRight className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="right">Expandir menú</TooltipContent>
            </Tooltip>
          ) : null}

          <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
            <SidebarNav collapsed={collapsed} />
          </div>

          <div className="space-y-1 border-t border-white/10 pt-3">
            {utilities.map((item) => (
              <SidebarUtilityLink
                key={item.id}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={collapsed}
                active={isUtilityNavigationItemActive(item, pathname)}
              />
            ))}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function SidebarUtilityLink({
  href,
  label,
  icon: Icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  active: boolean;
}) {
  const link = (
    <Link
      href={href}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
        active && "bg-white/8 text-white",
        collapsed && "justify-center px-0",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {!collapsed ? <span>{label}</span> : null}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={10}>{label}</TooltipContent>
    </Tooltip>
  );
}
