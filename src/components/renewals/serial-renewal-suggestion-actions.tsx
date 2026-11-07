"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dismissSerialRenewalSuggestion, linkRenewalToPolicy } from "@/app/(dashboard)/renewals/actions";
import { getPolicyRenewalReviewSource } from "@/app/(dashboard)/policies/actions";
import { RenewalLinkReviewDialog, type RenewalLinkReview } from "@/components/renewals/renewal-link-review-dialog";

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
  const [review, setReview] = useState<RenewalLinkReview | null>(null);

  const accept = () => startTransition(async () => {
    const [source, target] = await Promise.all([
      getPolicyRenewalReviewSource(sourcePolicyId),
      getPolicyRenewalReviewSource(targetPolicyId),
    ]);
    if (!source || !target) {
      toast.error("No se pudieron verificar las dos pólizas en tu cartera.");
      return;
    }
    setReview({ source, target });
  });

  const confirmLink = (versions: { sourceUpdatedAt: string; targetUpdatedAt: string }) => startTransition(async () => {
    const result = await linkRenewalToPolicy(sourcePolicyId, targetPolicyId, suggestionId, versions);
    if (!result.ok) {
      toast.error(result.error);
      setReview(null);
      router.refresh();
      return;
    }
    toast.success(result.message);
    setReview(null);
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
      <RenewalLinkReviewDialog
        review={review}
        allowDifferentInsurer
        pending={pending}
        onOpenChange={(open) => { if (!open) setReview(null); }}
        onConfirm={confirmLink}
      />
    </div>
  );
}
