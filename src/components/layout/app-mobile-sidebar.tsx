"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";

export function AppMobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Sheet key={pathname} open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            aria-label="Abrir menú de navegación"
            className="rounded-full bg-card/75 lg:hidden"
          />
        }
      >
        <Menu className="size-4" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 max-w-[85vw] border-sidebar-border/80 bg-sidebar/95 p-4 backdrop-blur-xl"
      >
        <div className="flex h-full flex-col">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-3xl border bg-card/70 p-3 shadow-sm"
          >
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">PG</p>
              <p className="text-xs text-muted-foreground">Cockpit de seguros</p>
            </div>
          </Link>

          <div className="mt-5 flex min-h-0 flex-1 flex-col">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
