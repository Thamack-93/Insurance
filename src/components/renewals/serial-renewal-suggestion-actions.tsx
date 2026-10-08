"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dismissSerialRenewalSuggestion, linkRenewalToPolicy } from "@/app/(dashboard)/renewals/actions";

export function SerialRenewalSuggestionActions({
  suggestionId,
  sourcePolicyId,
  targetPolicyId,
}: {
  suggestionId: string;
  sourcePolicyId: string;
  targetPolicyId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const accept = () => startTransition(async () => {
    const result = await linkRenewalToPolicy(sourcePolicyId, targetPolicyId, undefined, suggestionId);
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(result.message);
    router.refresh();
  });

  const dismiss = () => startTransition(async () => {
    const result = await dismissSerialRenewalSuggestion(suggestionId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.message);
    router.refresh();
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={accept}>
        Vincular como renovación
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={dismiss}>
        Descartar sugerencia
      </Button>
    </div>
  );
}
