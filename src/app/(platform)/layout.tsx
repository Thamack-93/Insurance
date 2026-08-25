import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { requireSuperAdminOrRedirect } from "@/lib/auth";
import { THEME_COOKIE } from "@/lib/settings-runtime";
import { PlatformSidebar } from "@/components/platform/platform-sidebar";
import { PlatformTopbar } from "@/components/platform/platform-topbar";
import { PlatformUserMenu } from "@/components/platform/platform-user-menu";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  await connection();
  await requireSuperAdminOrRedirect();
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;
  const initialTheme = themeCookie === "dark" ? "dark" : "light";
  return <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950"><a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-cyan-600 focus:px-4 focus:py-2 focus:text-white">Saltar al contenido principal</a><div className="flex min-h-screen"><PlatformSidebar /><div className="min-w-0 flex-1"><PlatformTopbar initialTheme={initialTheme} userMenu={<PlatformUserMenu />} /><main id="main-content" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main></div></div></div>;
}
