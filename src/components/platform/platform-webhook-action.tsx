"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MutationResult } from "@/lib/mutation-utils";

export function PlatformWebhookAction({ action }: { action: () => Promise<MutationResult> }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      const response = await action();
      if (response.ok) {
        setResult(response.message);
        toast.success(response.message);
      } else {
        setResult(response.error);
        toast.error(response.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <Button type="button" variant="outline" onClick={submit} disabled={pending} aria-busy={pending}>
        {pending ? "Sincronizando…" : "Sincronizar webhook"}
      </Button>
      {result ? <p className="text-right text-sm text-muted-foreground" role="status" aria-live="polite">{result}</p> : null}
    </div>
  );
}
