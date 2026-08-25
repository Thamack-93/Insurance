"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { platformNavigation, platformUtilityNavigation, isPlatformNavigationItemActive } from "@/lib/platform-navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STORAGE_KEY = "policydesk.platform-sidebar.collapsed";

export function PlatformSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    queueMicrotask(() => {
      try { setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true"); } catch { /* optional */ }
    });
  }, []);

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* optional */ }
  }, [collapsed]);

  return (
    <TooltipProvider>
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 border-r border-slate-800 bg-slate-950 text-slate-300 transition-[width] duration-200 lg:block", collapsed ? "w-[76px]" : "w-64")}>
        <div className="flex h-full flex-col px-3 py-4">
          <div className="flex items-center justify-between gap-2">
            <Link href="/platform" aria-label="PolicyDesk Plataforma, ir a Resumen" className={cn("flex min-h-11 items-center gap-3 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400", collapsed && "justify-center px-0")}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-400/15 text-cyan-300"><ShieldCheck className="size-5" aria-hidden /></span>
              {!collapsed ? <span className="font-display text-[17px] tracking-tight text-white">PolicyDesk <span className="text-cyan-300">Plataforma</span></span> : null}
            </Link>
            {!collapsed ? <button type="button" onClick={toggle} aria-label="Colapsar menú de plataforma" className="grid size-9 place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><ChevronLeft className="size-4" aria-hidden /></button> : null}
          </div>
          {collapsed ? <Tooltip><TooltipTrigger render={<button type="button" onClick={toggle} aria-label="Expandir menú de plataforma" className="mt-2 grid min-h-10 w-full place-items-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" />}><ChevronRight className="size-4" aria-hidden /></TooltipTrigger><TooltipContent side="right">Expandir menú</TooltipContent></Tooltip> : null}
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <p className={cn("mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500", collapsed && "sr-only")}>Control de plataforma</p>
            <nav aria-label="Navegación de plataforma" className="space-y-1">
              {platformNavigation.map((item) => <PlatformLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />)}
            </nav>
          </div>
          <div className="space-y-1 border-t border-slate-800 pt-3">
            {platformUtilityNavigation.map((item) => <PlatformLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />)}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function PlatformLink({ item, pathname, collapsed }: { item: (typeof platformNavigation)[number]; pathname: string; collapsed: boolean }) {
  const Icon = item.icon;
  const active = isPlatformNavigationItemActive(item, pathname);
  const link = <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={collapsed ? item.label : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400", active && "bg-cyan-400/15 font-semibold text-white shadow-[inset_3px_0_0_#22d3ee]", collapsed && "justify-center px-0")}>
    <Icon className={cn("size-[18px] shrink-0", active && "text-cyan-300")} aria-hidden />
    {!collapsed ? <span className="truncate">{item.label}</span> : null}
  </Link>;
  if (!collapsed) return link;
  return <Tooltip><TooltipTrigger render={link} /><TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent></Tooltip>;
}
