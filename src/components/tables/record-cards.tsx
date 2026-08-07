import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type RecordCardField = {
  label: string;
  value: ReactNode;
  /** Renders the value in the accent weight used for amounts and totals. */
  emphasis?: boolean;
};

export type RecordCardItem = {
  id: string;
  title: ReactNode;
  href?: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields: RecordCardField[];
  /** Rendered before the title, e.g. a selection checkbox. */
  leading?: ReactNode;
  actions?: ReactNode;
};

export type RecordCardsProps = {
  items: RecordCardItem[];
  /** Accessible name for the list, e.g. "Pólizas". */
  label: string;
  className?: string;
};

/**
 * Narrow-screen counterpart of a data table: each row becomes a card with its
 * priority fields, so phones read the list vertically instead of dragging a
 * dense table sideways. Pair it with a `hidden md:block` wrapper on the table.
 */
export function RecordCards({ items, label, className }: RecordCardsProps) {
  if (items.length === 0) return null;

  return (
    <ul aria-label={label} className={cn("divide-y divide-border/70 md:hidden", className)}>
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-3 px-4 py-4">
          <div className="flex items-start gap-3">
            {item.leading ? <div className="pt-0.5">{item.leading}</div> : null}
            <div className="min-w-0 flex-1">
              {item.href ? (
                <Link
                  href={item.href}
                  className="block truncate font-medium text-foreground hover:text-primary"
                >
                  {item.title}
                </Link>
              ) : (
                <p className="truncate font-medium text-foreground">{item.title}</p>
              )}
              {item.subtitle ? (
                <p className="mt-1 text-sm text-muted-foreground">{item.subtitle}</p>
              ) : null}
            </div>
            {item.badge ? <div className="shrink-0">{item.badge}</div> : null}
          </div>

          {item.fields.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              {item.fields.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{field.label}</dt>
                  <dd
                    className={cn(
                      "truncate text-sm text-foreground",
                      field.emphasis && "font-medium",
                    )}
                  >
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {item.actions ? <div className="flex flex-wrap gap-2">{item.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
}
