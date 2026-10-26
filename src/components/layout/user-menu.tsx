import { User as UserIcon } from "@/components/icons";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/layout/logout-button";

export async function UserMenu({ mobile = false }: { mobile?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className={`flex items-center gap-2 ${mobile ? "justify-between" : ""}`}>
      <div className={`min-w-0 flex-col ${mobile ? "flex text-left" : "hidden text-right md:flex"}`}>
        <span className={`truncate text-xs font-medium leading-tight ${mobile ? "text-sidebar-accent-foreground" : "text-foreground"}`}>{user.name}</span>
        <span className={`truncate text-[11px] leading-tight ${mobile ? "text-sidebar-foreground/70" : "text-muted-foreground"}`}>
          {user.email} · {user.role === "ADMIN" ? "Administrador" : "Agente"}
        </span>
      </div>
      <span className="flex size-9 items-center justify-center rounded-full border bg-white/80 text-muted-foreground dark:bg-stone-800/80">
        <UserIcon className="size-4" aria-hidden />
      </span>
      <LogoutButton userId={user.id} />
    </div>
  );
}
