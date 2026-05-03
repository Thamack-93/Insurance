import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { UserMenu } from "@/components/layout/user-menu";
import { SearchProvider } from "@/components/search/search-provider";
import { CommandPaletteWrapper } from "@/components/command/command-palette-wrapper";
import { ShortcutsHelp } from "@/components/shortcuts/shortcuts-help";
import { getSettings } from "@/lib/settings";
import { RuntimeSettingsHydrator } from "@/components/settings/runtime-settings-hydrator";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Load settings once per request: hydrates the server runtime cache and
  // is forwarded to the client so format helpers stay consistent on both sides.
  const settings = await getSettings();
  return (
    <SearchProvider>
      <RuntimeSettingsHydrator settings={settings} />
      <div className="min-h-screen">
        <div className="flex min-h-screen">
          <AppSidebar />
          <div className="min-w-0 flex-1">
            <AppTopbar userMenu={<UserMenu />} />
            <main className="mx-auto w-full max-w-[1560px] px-5 py-8 lg:px-8">{children}</main>
          </div>
        </div>
        <CommandPaletteWrapper />
        <ShortcutsHelp />
      </div>
    </SearchProvider>
  );
}

