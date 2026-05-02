import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { CommandPaletteWrapper } from "@/components/command/command-palette-wrapper";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="flex min-h-screen">
        <AppSidebar />
        <div className="min-w-0 flex-1">
          <AppTopbar />
          <main className="mx-auto w-full max-w-[1560px] px-5 py-8 lg:px-8">{children}</main>
        </div>
      </div>
      <CommandPaletteWrapper />
    </div>
  );
}

