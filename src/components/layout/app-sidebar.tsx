import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
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

        <div className="mt-5 rounded-2xl border bg-card/55 p-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search className="size-4" />
            Buscar cliente, póliza, recibo...
          </div>
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <SidebarNav isAdmin={isAdmin} />
        </div>

        <div className="mt-auto rounded-3xl border bg-card/65 p-4 shadow-sm">
          <p className="text-sm font-semibold">Operaciones locales</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            SQLite, documentos privados y backups seguros en `data/`.
          </p>
        </div>
      </div>
    </aside>
  );
}
