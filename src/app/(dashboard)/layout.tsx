import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { UserMenu } from "@/components/layout/user-menu";
import { SearchProvider } from "@/components/search/search-provider";
import { CommandPaletteWrapper } from "@/components/command/command-palette-wrapper";
import { ShortcutsHelp } from "@/components/shortcuts/shortcuts-help";
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings";
import { RuntimeSettingsHydrator } from "@/components/settings/runtime-settings-hydrator";
import { getUnreadAlertCount, getRecentAlerts } from "@/lib/notifications";
import type { AlertRecord } from "@/lib/notifications";
import { requireUserOrRedirect } from "@/lib/auth";

const fallbackSettings: Settings = {
  firmName: "PG",
  firmEmail: "",
  firmPhone: "",
  firmAddress: "",
  firmRfc: "",
  defaultCurrency: "MXN",
  dateFormat: "DD/MM/YYYY",
  theme: "light",
  emailNotifications: true,
  smsNotifications: false,
  autoBackup: false,
  backupFrequency: "weekly",
  retentionDays: 30,
};

async function getSafeDashboardShellData() {
  const [settingsResult, unreadResult, alertsResult] = await Promise.allSettled([
    getSettings(),
    getUnreadAlertCount(),
    getRecentAlerts(10),
  ]);

  return {
    settings: settingsResult.status === "fulfilled" ? settingsResult.value : fallbackSettings,
    unreadAlertCount: unreadResult.status === "fulfilled" ? unreadResult.value : 0,
    recentAlerts: alertsResult.status === "fulfilled" ? alertsResult.value : ([] as AlertRecord[]),
  };
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Re-validate the user against the database on every dashboard request so
  // deactivations and role changes take effect immediately, rather than
  // waiting for the signed session token to expire.
  await requireUserOrRedirect();
  // Load settings once per request: hydrates the server runtime cache and
  // is forwarded to the client so format helpers stay consistent on both sides.
  const { settings, unreadAlertCount, recentAlerts } = await getSafeDashboardShellData();
  const bellAlerts = recentAlerts.map((alert) => ({
    id: alert.id,
    alertType: alert.alertType,
    severity: alert.severity,
    title: alert.title,
    description: alert.description,
    entityType: alert.entityType,
    entityId: alert.entityId,
    createdAt: alert.createdAt.toISOString(),
    readAt: alert.readAt ? alert.readAt.toISOString() : null,
  }));
  return (
    <SearchProvider>
      <RuntimeSettingsHydrator settings={settings} />
      <div className="min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Saltar al contenido principal
        </a>
        <div className="flex min-h-screen">
          <AppSidebar />
          <div className="min-w-0 flex-1">
            <AppTopbar
              userMenu={<UserMenu />}
              unreadAlertCount={unreadAlertCount}
              alerts={bellAlerts}
            />
            <main id="main-content" className="mx-auto w-full max-w-[1560px] px-3 py-6 sm:px-5 sm:py-8 lg:px-8">{children}</main>
          </div>
        </div>
        <CommandPaletteWrapper />
        <ShortcutsHelp />
      </div>
    </SearchProvider>
  );
}
