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
  approveAction: ReviewAction;
  denyAction: ReviewAction;
  approveLabel?: string;
  denyLabel?: string;
  modifyLabel?: string;
  className?: string;
};

export function ReviewActionButtons({
  id,
  modifyHref,
  approveAction,
  denyAction,
  approveLabel = "Aprobar",
  denyLabel = "Denegar",
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={isPending}
        onClick={() => run(approveAction, "Aprobado.")}
      >
        {approveLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-full"
        disabled={isPending}
        onClick={() => run(denyAction, "Denegado.")}
      >
        {denyLabel}
      </Button>
      <Button asChild type="button" size="sm" variant="ghost" className="rounded-full">
        <Link href={modifyHref}>{modifyLabel}</Link>
      </Button>
    </div>
  );
}
