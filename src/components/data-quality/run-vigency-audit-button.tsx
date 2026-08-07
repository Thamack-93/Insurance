"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MutationResult } from "@/lib/mutation-utils";

type Props = {
  runVigencyAudit: () => Promise<MutationResult>;
};

export function RunVigencyAuditButton({ runVigencyAudit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    startTransition(async () => {
      const result = await runVigencyAudit();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Button type="button" onClick={handleRun} disabled={isPending}>
      <RefreshCw className="mr-2 size-4" />
      {isPending ? "Ejecutando…" : "Revisar vigencias"}
    </Button>
  );
}
