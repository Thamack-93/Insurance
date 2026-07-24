"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssistantActionProposal } from "@/lib/assistant-types";
import { cn } from "@/lib/utils";

const ENTITY_LABELS: Record<AssistantActionProposal["entityType"], string> = {
  client: "Cliente",
  policy: "Póliza",
  receipt: "Recibo",
  payment: "Pago",
  task: "Tarea",
  endorsement: "Endoso",
};

export function AssistantActionProposalCard({ proposal }: { proposal: AssistantActionProposal }) {
  const router = useRouter();
  const [status, setStatus] = useState<"pending" | "confirming" | "confirmed">("pending");

  async function confirmProposal() {
    if (status !== "pending") return;
    setStatus("confirming");

    try {
      const response = await fetch("/api/assistant/actions/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: proposal.draftId }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; result?: { ok: boolean; message?: string; redirectTo?: string; error?: string }; error?: string }
        | null;

      if (!response.ok || !payload?.success || !payload.result?.ok) {
        throw new Error(payload?.result?.error || payload?.error || "No se pudo confirmar la propuesta.");
      }

      toast.success(payload.result.message || "Cambios aplicados.");
      setStatus("confirmed");
      router.refresh();
      if (payload.result.redirectTo) {
        router.push(payload.result.redirectTo);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo confirmar la propuesta.";
      toast.error(message);
      setStatus("pending");
    }
  }

  return (
    <div className="mt-3 overflow-hidden rounded-3xl border border-border/70 bg-background/95 shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{proposal.title}</p>
          <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-wide">
            {proposal.operation === "create" ? "Crear" : "Editar"}
          </Badge>
          <Badge variant="secondary" className="rounded-full text-[10px] uppercase tracking-wide">
            {ENTITY_LABELS[proposal.entityType]}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{proposal.summary}</p>
        {proposal.targetLabel ? <p className="mt-1 text-xs text-muted-foreground">Objetivo: {proposal.targetLabel}</p> : null}
      </div>
      <div className="px-4 py-4">
        <div className="space-y-2">
          {proposal.changes.map((change) => (
            <div key={`${change.label}-${change.after}`} className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{change.label}</p>
              <p className="mt-1 text-sm font-medium">{change.after || "Sin dato"}</p>
              {change.before ? <p className="mt-0.5 text-xs text-muted-foreground">Antes: {change.before}</p> : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Expira el {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(proposal.expiresAt))}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
        <Button
          type="button"
          size="sm"
          className={cn("rounded-full", status === "confirmed" && "opacity-80")}
          disabled={status !== "pending"}
          onClick={confirmProposal}
        >
          {status === "confirming" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {status === "confirmed" ? "Confirmado" : proposal.confirmLabel}
        </Button>
      </div>
    </div>
  );
}
