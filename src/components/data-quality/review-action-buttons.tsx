"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MutationResult } from "@/lib/mutation-utils";

type ReviewAction = (id: string) => Promise<MutationResult>;

type ReviewActionButtonsProps = {
  id: string;
  modifyHref: string;
  approveAction?: ReviewAction;
  denyAction?: ReviewAction;
  suppressAction?: ReviewAction;
  reopenAction?: ReviewAction;
  approveLabel?: string;
  denyLabel?: string;
  suppressLabel?: string;
  reopenLabel?: string;
  modifyLabel?: string;
  className?: string;
};

export function ReviewActionButtons({
  id,
  modifyHref,
  approveAction,
  denyAction,
  suppressAction,
  reopenAction,
  approveLabel = "Aprobar",
  denyLabel = "Denegar",
  suppressLabel = "Suprimir",
  reopenLabel = "Reabrir",
  modifyLabel = "Modificar",
  className,
}: ReviewActionButtonsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: ReviewAction, successMessage: string) {
    startTransition(async () => {
      const result = await action(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message ?? successMessage);
      router.refresh();
    });
  }

  return (
    <div className={className ?? "flex flex-wrap items-center justify-end gap-2"}>
      {approveAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"

          disabled={isPending}
          onClick={() => run(approveAction, "Aprobado.")}
        >
          {approveLabel}
        </Button>
      ) : null}
      {denyAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"

          disabled={isPending}
          onClick={() => run(denyAction, "Denegado.")}
        >
          {denyLabel}
        </Button>
      ) : null}
      {suppressAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"

          disabled={isPending}
          onClick={() => run(suppressAction, "Suprimido.")}
        >
          {suppressLabel}
        </Button>
      ) : null}
      {reopenAction ? (
        <Button
          type="button"
          size="sm"
          variant="outline"

          disabled={isPending}
          onClick={() => run(reopenAction, "Reabierto.")}
        >
          {reopenLabel}
        </Button>
      ) : null}
      <Button asChild type="button" size="sm" variant="ghost">
        <Link href={modifyHref}>{modifyLabel}</Link>
      </Button>
    </div>
  );
}
