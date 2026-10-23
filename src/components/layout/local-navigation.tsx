"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { isLocalNavigationItemActive, type LocalNavigationItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function LocalNavigation({
  items,
  label = "Navegación de sección",
  variant = "tabs",
}: {
  items: LocalNavigationItem[];
  label?: string;
  variant?: "tabs" | "compact";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const compact = variant === "compact";

  return (
    <nav aria-label={label} className={compact ? "shrink-0" : "-mx-1 overflow-x-auto px-1"}>
      <div className={cn(
        "flex min-w-max items-center",
        compact ? "gap-1 rounded-lg border bg-muted/40 p-1" : "gap-6 border-b border-border",
      )}>
        {items.map((item) => {
          const active = isLocalNavigationItemActive(item, pathname, searchParams);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "min-h-8 rounded-md px-3" : "relative min-h-11 px-1 text-muted-foreground hover:text-foreground",
                compact && active && "bg-background text-foreground shadow-sm",
                !compact && active && "text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
