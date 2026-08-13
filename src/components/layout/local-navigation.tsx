"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { isLocalNavigationItemActive, type LocalNavigationItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function LocalNavigation({
  items,
  label = "Navegación de sección",
}: {
  items: LocalNavigationItem[];
  label?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <div className="flex min-w-max items-center gap-6 border-b border-border">
        {items.map((item) => {
          const active = isLocalNavigationItemActive(item, pathname, searchParams);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex min-h-11 items-center whitespace-nowrap px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary",
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
