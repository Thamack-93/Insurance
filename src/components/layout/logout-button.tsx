"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearNoraBrowserSession } from "@/lib/nora-browser-session";

export function LogoutButton({ userId }: { userId: string }) {
  function handleSubmit() {
    clearNoraBrowserSession(userId);
  }

  return (
    <form action="/api/auth/logout" method="post" onSubmit={handleSubmit}>
      <Button
        type="submit"
        variant="outline"
        size="icon"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="cursor-pointer bg-white/75 dark:bg-stone-800/75"
      >
        <LogOut className="size-4" aria-hidden />
      </Button>
    </form>
  );
}
