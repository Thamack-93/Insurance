import { User as UserIcon } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/layout/logout-button";

export async function PlatformUserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <div className="flex items-center gap-2"><div className="hidden flex-col text-right md:flex"><span className="text-xs font-medium leading-tight text-foreground">{user.name}</span><span className="text-[11px] leading-tight text-muted-foreground">{user.email} · Superadmin</span></div><span className="flex size-9 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300"><UserIcon className="size-4" aria-hidden /></span><LogoutButton userId={user.id} /></div>;
}
