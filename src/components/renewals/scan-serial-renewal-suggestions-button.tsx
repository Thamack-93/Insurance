"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { scanSerialRenewalSuggestions } from "@/app/(dashboard)/renewals/actions";

export function ScanSerialRenewalSuggestionsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const result = await scanSerialRenewalSuggestions();
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message);
        router.refresh();
      })}
    >
      {pending ? "Buscando…" : "Buscar coincidencias por serie"}
    </Button>
  );
}
