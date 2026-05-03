import { LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";

export async function UserMenu() {
  const session = await getSession();
  if (!session) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden flex-col text-right md:flex">
        <span className="text-xs font-medium text-foreground leading-tight">{session.name}</span>
        <span className="text-[11px] text-muted-foreground leading-tight">{session.email}</span>
      </div>
      <span className="flex size-9 items-center justify-center rounded-full border bg-white/80 text-muted-foreground dark:bg-stone-800/80">
        <UserIcon className="size-4" aria-hidden />
      </span>
      <form action="/api/auth/logout" method="post">
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="rounded-full bg-white/75 dark:bg-stone-800/75 cursor-pointer"
        >
          <LogOut className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
