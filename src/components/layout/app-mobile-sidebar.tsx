"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { cn } from "@/lib/utils";
import { getUtilityNavigation, isUtilityNavigationItemActive } from "@/lib/navigation";

export function AppMobileSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const utilities = getUtilityNavigation(isAdmin);

  return (
    <Sheet key={pathname} open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="Abrir menú de navegación"
            className="rounded-md bg-card lg:hidden"
          />
        }
      >
        <Menu className="size-4" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 max-w-[88vw] border-sidebar-border bg-sidebar p-4 text-sidebar-foreground"
      >
        <div className="flex h-full flex-col">
          <Link
            href="/today"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <ShieldCheck className="size-6 shrink-0 text-sidebar-primary" aria-hidden />
            <div>
              <p className="font-display text-lg tracking-tight text-sidebar-accent-foreground">PolicyDesk</p>
              <p className="text-xs text-sidebar-foreground/70">Operación de seguros</p>
            </div>
          </Link>
          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
          <div className="space-y-1 border-t border-sidebar-border pt-3">
            {utilities.map((item) => {
              const Icon = item.icon;
              const active = isUtilityNavigationItemActive(item, pathname);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden /> {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
