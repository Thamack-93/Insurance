"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { BonusRunActionState } from "@/lib/bonus-approval";

type BonusRunAction = (state: BonusRunActionState, formData: FormData) => Promise<BonusRunActionState>;

type BonusRunActionFormProps = {
  action: BonusRunAction;
  runId: string;
  version: number;
  policyId?: string;
  disabled?: boolean;
  buttonLabel: string;
  attestationLabel: string;
  variant?: "default" | "outline";
  className?: string;
};

export function BonusRunActionForm({
  action,
  runId,
  version,
  policyId,
  disabled = false,
  buttonLabel,
  attestationLabel,
  variant = "default",
  className = "",
}: BonusRunActionFormProps) {
  const [state, formAction, pending] = useActionState(action, null);
  const stale = state?.code === "STALE_VERSION";

  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="version" value={version} />
      {policyId ? <input type="hidden" name="policyId" value={policyId} /> : null}
      <label className="flex max-w-md items-start gap-2 text-xs text-muted-foreground">
        <input required type="checkbox" name="reviewAttestation" className="mt-0.5 accent-primary" disabled={disabled || pending || stale} />
        <span>{attestationLabel}</span>
      </label>
      <Button type="submit" variant={variant} disabled={disabled || pending || stale}>
        {pending ? "Procesando…" : buttonLabel}
      </Button>
      {stale ? (
        <div role="alert" className="max-w-md rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
          <p>La proyección cambió desde que la abriste. Se rechazó esta acción. Recarga y revisa la versión actual antes de continuar.</p>
          <Link className="mt-2 inline-flex font-medium text-primary underline underline-offset-4" href={`/bonuses?run=${encodeURIComponent(runId)}`}>
            Recargar y revisar la versión actual
          </Link>
        </div>
      ) : null}
    </form>
  );
}
