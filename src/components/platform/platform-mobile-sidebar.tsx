"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { platformNavigation, platformUtilityNavigation, isPlatformNavigationItemActive } from "@/lib/platform-navigation";
import { cn } from "@/lib/utils";

export function PlatformMobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = [...platformNavigation, ...platformUtilityNavigation];
  return (
    <Sheet key={pathname} open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Abrir menú de plataforma" className="rounded-md border-slate-300 bg-card lg:hidden" />}><Menu className="size-4" aria-hidden /></SheetTrigger>
      <SheetContent side="left" className="w-72 max-w-[88vw] border-slate-800 bg-slate-950 p-4 text-slate-300">
        <div className="flex h-full flex-col">
          <Link href="/platform" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><span className="grid size-8 place-items-center rounded-lg bg-cyan-400/15 text-cyan-300"><ShieldCheck className="size-5" aria-hidden /></span><div><p className="font-display text-lg tracking-tight text-white">PolicyDesk</p><p className="text-xs text-cyan-300">Plataforma master</p></div></Link>
          <nav aria-label="Navegación de plataforma" className="mt-6 flex min-h-0 flex-1 flex-col gap-1">
            {items.map((item) => { const Icon = item.icon; const active = isPlatformNavigationItemActive(item, pathname); return <Link key={item.id} href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400", active && "bg-cyan-400/15 font-semibold text-white")}><Icon className={cn("size-[18px]", active && "text-cyan-300")} aria-hidden />{item.label}</Link>; })}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
