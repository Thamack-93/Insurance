"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle, type ThemeMode } from "@/components/theme/theme-toggle";
import { PlatformMobileSidebar } from "@/components/platform/platform-mobile-sidebar";
import { getPlatformBreadcrumbSegments } from "@/lib/platform-navigation";

export function PlatformTopbar({ userMenu, initialTheme }: { userMenu?: ReactNode; initialTheme: ThemeMode }) {
  const pathname = usePathname();
  const segments = getPlatformBreadcrumbSegments(pathname);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-background/90 backdrop-blur-xl dark:border-slate-800">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-5 lg:gap-4 lg:px-8">
        <PlatformMobileSidebar />
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:flex"><span className="font-display text-[15px] text-foreground">PolicyDesk</span><span aria-hidden>/</span><span className="font-medium text-cyan-700 dark:text-cyan-300">Plataforma</span>{segments.map(({ segment, label }) => <span key={`${segment}-${label}`} className="flex items-center gap-2"><span aria-hidden>/</span><span className="font-medium text-foreground">{label}</span></span>)}</nav>
        <div className="ml-auto flex items-center gap-2"><span className="hidden rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800 sm:inline-flex dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">Sesión master</span><ThemeToggle initialTheme={initialTheme} />{userMenu}</div>
      </div>
    </header>
  );
}
