"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { globalNavigation, isNavigationItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
      {globalNavigation.map((item) => {
        const Icon = item.icon;
        const active = isNavigationItemActive(item, pathname);
        const link = (
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
              active && "bg-cyan-400/15 text-white shadow-[inset_3px_0_0_#22d3ee]",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={cn("size-[18px] shrink-0", active && "text-cyan-300")} aria-hidden />
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
    </nav>
  );
}
