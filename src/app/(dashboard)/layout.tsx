import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { UserMenu } from "@/components/layout/user-menu";
import { SearchProvider } from "@/components/search/search-provider";
import { CommandPaletteWrapper } from "@/components/command/command-palette-wrapper";
import { ShortcutsHelp } from "@/components/shortcuts/shortcuts-help";
import { getSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings";
import { RuntimeSettingsHydrator } from "@/components/settings/runtime-settings-hydrator";
import { getUnreadNotificationCount, getRecentNotifications } from "@/lib/notifications";
import type { NotificationRecord } from "@/lib/notifications";
import { requireUserOrRedirect } from "@/lib/auth";
import { THEME_COOKIE } from "@/lib/settings-runtime";
import { NoraSessionProvider } from "@/components/assistant/nora-session-provider";
import { resolveOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

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

async function getSafeDashboardShellData(organizationId?: string) {
  const [settingsResult, unreadResult, notificationsResult] = await Promise.allSettled([
    getSettings(),
    organizationId ? getUnreadNotificationCount(organizationId) : Promise.resolve(0),
    organizationId ? getRecentNotifications(10, organizationId) : Promise.resolve([] as NotificationRecord[]),
  ]);

  return {
    settings: settingsResult.status === "fulfilled" ? settingsResult.value : fallbackSettings,
    unreadNotificationCount: unreadResult.status === "fulfilled" ? unreadResult.value : 0,
    recentNotifications:
      notificationsResult.status === "fulfilled" ? notificationsResult.value : ([] as NotificationRecord[]),
    notificationsUnavailable: unreadResult.status === "rejected" || notificationsResult.status === "rejected",
  };
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await connection();
  // Re-validate the user against the database on every dashboard request so
  // deactivations and role changes take effect immediately, rather than
  // waiting for the signed session token to expire.
  const user = await requireUserOrRedirect();
  const organizationResolution = await resolveOrganizationContext();
  const organization = organizationResolution.status === "ready" ? organizationResolution.context : null;
  const organizationKind = organization ? await withTenantTransaction(organization, (tx) => tx.organization.findUnique({ where: { id: organization.organizationId }, select: { kind: true } })) : null;
  const isTenantAdmin = Boolean(organization && organization.membershipRole !== "AGENT");
  // Mirrors the root layout: the theme is known server-side from the cookie, so
  // the theme toggle can render its destination label without a hydration gap.
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;
  const initialTheme = themeCookie === "dark" ? "dark" : "light";
  // Load settings once per request: hydrates the server runtime cache and
  // is forwarded to the client so format helpers stay consistent on both sides.
  const { settings, unreadNotificationCount, recentNotifications, notificationsUnavailable } = await getSafeDashboardShellData(organization?.organizationId);
  const bellNotifications = recentNotifications.map((notification) => ({
    id: notification.id,
    alertType: notification.alertType,
    severity: notification.severity,
    title: notification.title,
    description: notification.description,
    entityType: notification.entityType,
    entityId: notification.entityId,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
  }));
  return (
    <SearchProvider>
      <NoraSessionProvider userId={user.id} organizationId={organization?.organizationId ?? ""} demoMode={organizationKind?.kind === "DEMO"}>
        <RuntimeSettingsHydrator settings={settings} />
        <div className="min-h-screen">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Saltar al contenido principal
          </a>
          <div className="flex min-h-screen">
            <AppSidebar isAdmin={isTenantAdmin} isSuperAdmin={user.platformRole === "SUPERADMIN"} />
            <div className="min-w-0 flex-1">
              <AppTopbar
                isAdmin={isTenantAdmin}
                isSuperAdmin={user.platformRole === "SUPERADMIN"}
                hasOrganizationContext={Boolean(organization)}
                organizationName={organization?.organizationName}
                membershipRole={organization?.membershipRole}
                userMenu={<UserMenu />}
                unreadNotificationCount={unreadNotificationCount}
                notifications={bellNotifications}
                initialTheme={initialTheme}
              />
              <main id="main-content" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                {notificationsUnavailable ? (
                  <div role="status" className="mb-4 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Las notificaciones no están disponibles temporalmente. El resto de la operación continúa funcionando.
                  </div>
                ) : null}
                {children}
              </main>
            </div>
          </div>
          <CommandPaletteWrapper
            isAdmin={isTenantAdmin}
            isSuperAdmin={user.platformRole === "SUPERADMIN"}
            hasOrganizationContext={Boolean(organization)}
          />
          <ShortcutsHelp />
        </div>
      </NoraSessionProvider>
    </SearchProvider>
  );
}
