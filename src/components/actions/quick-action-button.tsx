import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuickActionButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Button variant="outline" size="sm" className="bg-card/80">
      <Icon className="size-4" />
      {label}
    </Button>
  );
}

