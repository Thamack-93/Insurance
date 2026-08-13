import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * An empty-state action must always lead somewhere: either a destination
 * (`href`) or a handler (`onClick`). The union makes a label without a
 * destination unrepresentable, so a dead button can no longer be rendered.
 */
export type EmptyStateAction =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never };

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
}) {
  return (
    <Card className="border-dashed bg-card/65">
      <CardContent className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Icon className="size-7 text-primary" />
        </div>
        <h3 className="mt-5 text-lg font-semibold">{title}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
        {action ? (
          action.href ? (
            <Button asChild className="mt-5" variant="outline">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button className="mt-5" variant="outline" type="button" onClick={action.onClick}>
              {action.label}
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
