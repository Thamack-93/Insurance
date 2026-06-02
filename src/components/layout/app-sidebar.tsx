import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
import { CommandPaletteTrigger } from "./command-palette-trigger";
import { getCurrentUser } from "@/lib/auth";

export async function AppSidebar() {
  const user = await getCurrentUser();
  const isAdmin = !!user && user.active && user.role === "ADMIN";
  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-sidebar-border/80 bg-sidebar/85 p-4 backdrop-blur-xl lg:block">
      <div className="flex h-full flex-col">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-3xl border bg-card/70 p-3 shadow-sm">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">PG</p>
            <p className="text-xs text-muted-foreground">Cockpit de seguros</p>
          </div>
        </Link>

        <CommandPaletteTrigger className="mt-5" />

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <SidebarNav isAdmin={isAdmin} />
        </div>

      </div>
    </aside>
  );
}
