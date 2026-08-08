import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    // `h-full` + a flex column so the chart inside can claim the leftover
    // height instead of sitting on a fixed one.
    <Card className="flex h-full flex-col bg-card shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">{children}</CardContent>
    </Card>
  );
}
