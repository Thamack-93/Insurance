import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionHref,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <Card className="border-dashed bg-card/65">
      <CardContent className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
        <div className="rounded-3xl border bg-card p-4 shadow-sm">
          <Icon className="size-7 text-primary" />
        </div>
        <h3 className="mt-5 text-lg font-semibold">{title}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
        {action && actionHref ? (
          <Button asChild className="mt-5 rounded-full" variant="outline">
            <Link href={actionHref}>{action}</Link>
          </Button>
        ) : action ? (
          <Button className="mt-5 rounded-full" variant="outline">
            {action}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
