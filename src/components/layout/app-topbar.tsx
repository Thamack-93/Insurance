"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Command, Sparkles } from "lucide-react";
import { SearchInput } from "@/components/search/search-input";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationsBell, type BellNotification } from "@/components/notifications/notifications-bell";
import { AppMobileSidebar } from "@/components/layout/app-mobile-sidebar";
import { useNoraSession } from "@/components/assistant/nora-session-provider";
import { getBreadcrumbSegments } from "@/lib/navigation";

export function AppTopbar({
  userMenu,
  isAdmin = false,
  isSuperAdmin = false,
  hasOrganizationContext = false,
  unreadNotificationCount,
  notifications,
}: {
  userMenu?: ReactNode;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  hasOrganizationContext?: boolean;
  unreadNotificationCount: number;
  notifications: BellNotification[];
}) {
  const pathname = usePathname();
  const { openNora } = useNoraSession();
  const segments = getBreadcrumbSegments(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-5 lg:gap-4 lg:px-8">
        <AppMobileSidebar isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} />
        <nav aria-label="Breadcrumb" className="hidden shrink-0 items-center gap-2 text-sm text-muted-foreground md:flex">
          <span>PolicyDesk</span>
          {segments.map(({ segment, label }, index) => (
            <span key={`${index}-${segment}`} className="flex items-center gap-2">
              <span aria-hidden>/</span>
              <span className="font-medium text-foreground">{label}</span>
            </span>
          ))}
        </nav>

        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
          {hasOrganizationContext ? <SearchInput /> : <span className="px-2 text-sm text-muted-foreground">Selecciona una organización para operar</span>}
          {hasOrganizationContext ? <button
            type="button"
            aria-label="Abrir paleta de comandos"
            onClick={() => window.dispatchEvent(new CustomEvent("pg:open-command-palette"))}
            className="hidden shrink-0 cursor-pointer items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
          >
            <Command className="size-3" /> K
          </button> : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          {hasOrganizationContext ? (
            <button
              type="button"
              onClick={() => openNora()}
              aria-label="Abrir Nora"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ai transition-colors hover:bg-ai/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles className="size-4" aria-hidden />
              <span className="hidden sm:inline">Nora</span>
            </button>
          ) : null}
          {hasOrganizationContext ? <NotificationsBell unreadCount={unreadNotificationCount} notifications={notifications} /> : null}
          {userMenu}
        </div>
      </div>
    </header>
  );
}
