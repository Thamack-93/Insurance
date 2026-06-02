"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MutationResult } from "@/lib/mutation-utils";

type Props = {
  runPaymentAudit: () => Promise<MutationResult>;
};

export function RunPaymentAuditButton({ runPaymentAudit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    startTransition(async () => {
      const result = await runPaymentAudit();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Button type="button" onClick={handleRun} disabled={isPending} className="rounded-full">
      <RefreshCw className="mr-2 size-4" />
      {isPending ? "Ejecutando…" : "Revisar pagos"}
    </Button>
  );
}
