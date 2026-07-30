import { User as UserIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/layout/logout-button";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden flex-col text-right md:flex">
        <span className="text-xs font-medium text-foreground leading-tight">{user.name}</span>
        <span className="text-[11px] text-muted-foreground leading-tight">
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
