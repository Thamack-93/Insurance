"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NoRenewalButton } from "@/components/renewals/no-renewal-button";
import { PolicySearchDialog } from "@/components/policies/policy-search-dialog";
import { getPolicyRenewalReviewSource } from "@/app/(dashboard)/policies/actions";
import { RenewalLinkReviewDialog, type RenewalLinkReview } from "@/components/renewals/renewal-link-review-dialog";
import { linkRenewalToPolicy } from "@/app/(dashboard)/renewals/actions";
import type { GlobalSearchResult } from "@/lib/search";

type RenewalRowActionsProps = {
  sourcePolicyId: string;
  sourcePolicyNumber: string;
  clientName: string;
  insurerName: string;
};

export function RenewalRowActions({
  sourcePolicyId,
  sourcePolicyNumber,
  clientName,
  insurerName,
}: RenewalRowActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkReview, setLinkReview] = useState<RenewalLinkReview | null>(null);

  const sourceLabel = `${sourcePolicyNumber} · ${clientName} · ${insurerName}`;
  const suggestions = useMemo(
    () => [sourcePolicyNumber, clientName, insurerName, `${clientName} ${insurerName}`, `${sourcePolicyNumber} ${insurerName}`],
    [clientName, insurerName, sourcePolicyNumber],
  );

  async function handleSelect(result: GlobalSearchResult) {
    try {
      setIsPending(true);
      const [source, target] = await Promise.all([
        getPolicyRenewalReviewSource(sourcePolicyId),
        getPolicyRenewalReviewSource(result.id),
      ]);
      if (!source || !target) {
        toast.error("No se pudieron verificar las dos pólizas en tu cartera.");
        return false;
      }
      setLinkReview({ source, target });
      return true;
    } finally {
      setIsPending(false);
    }
  }

  async function confirmLink(versions: { sourceUpdatedAt: string; targetUpdatedAt: string }) {
    if (!linkReview) return;
    try {
      setIsPending(true);
      const mutation = await linkRenewalToPolicy(sourcePolicyId, linkReview.target.id, undefined, versions);
      if (!mutation.ok) {
        toast.error(mutation.error);
        setLinkReview(null);
        return;
      }
      toast.success(mutation.message);
      setLinkReview(null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button asChild type="button" size="sm" disabled={isPending}>
        <Link href={`/policies/new?renewalFrom=${encodeURIComponent(sourcePolicyId)}`}>
          Renovar
          <ArrowRight className="ml-2 size-4" />
        </Link>
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"

        onClick={() => setSearchOpen(true)}
        disabled={isPending}
      >
        <Link2 className="mr-2 size-4" />
        Vincular renovación
      </Button>

      <NoRenewalButton
        policyId={sourcePolicyId}
        policyNumber={sourcePolicyNumber}
        triggerClassName="h-8 bg-card/70 px-3 text-xs"
        triggerLabel="No renueva"
      />

      <PolicySearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Vincular renovación"
        description="Busca la póliza destino por cliente, serie, aseguradora o número de póliza."
        placeholder="Cliente, póliza, aseguradora..."
        sourceLabel={sourceLabel}
        initialQuery={`${clientName} ${insurerName}`}
        suggestions={suggestions}
        onSelect={handleSelect}
      />
      <RenewalLinkReviewDialog
        review={linkReview}
        pending={isPending}
        onOpenChange={(open) => { if (!open) setLinkReview(null); }}
        onConfirm={confirmLink}
      />
    </div>
  );
}
