"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationRead, markAllNotificationsRead } from "@/app/(dashboard)/notifications/actions";
import { toast } from "sonner";

export function MarkOneButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      className="h-7 rounded-full px-2 text-xs"
      onClick={() => {
        startTransition(async () => {
          const result = await markNotificationRead(id);
          if (!result.ok) toast.error(result.error);
          router.refresh();
        });
      }}
    >
      Marcar como leída
    </Button>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      className="rounded-full bg-card/70"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await markAllNotificationsRead();
          if (!result.ok) toast.error(result.error);
          else toast.success(result.message);
          router.refresh();
        });
      }}
    >
      <CheckCheck className="mr-2 size-4" /> Marcar todas como leídas
    </Button>
  );
}
