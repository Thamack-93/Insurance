import { Activity } from "lucide-react";
import { formatDate } from "@/lib/dates";

export function ActivityTimeline({
  items,
}: {
  items: Array<{ id: string; action: string; entityType: string; createdAt: Date; performedBy: string }>;
}) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex gap-3">
          <div className="mt-0.5 rounded-full border bg-white p-2 text-primary shadow-sm">
            <Activity className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{item.action}</p>
            <p className="text-xs text-muted-foreground">
              {item.entityType} · {formatDate(item.createdAt)} · {item.performedBy}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

