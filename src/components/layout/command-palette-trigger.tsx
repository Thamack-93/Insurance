"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function CommandPaletteTrigger({
  className,
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}) {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent("pg:open-command-palette"));
    onOpen?.();
  };

  return (
    <button
      type="button"
      aria-label="Abrir búsqueda global"
      onClick={handleClick}
      className={cn(
        "w-full cursor-pointer rounded-2xl border bg-card/55 p-2 text-left text-sm text-muted-foreground transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex items-center gap-2 px-2 py-1.5">
        <Search className="size-4" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Buscar cliente, póliza, recibo...</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide">Cmd K</span>
      </span>
    </button>
  );
}
